import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTrip, postRating, rawTrip } from "../lib/cyclocity.ts";
import { haversine } from "../lib/geo.ts";
import { type Station, canRate, rateBodySchema } from "../lib/models.ts";
import { VelovError } from "../lib/auth-protocol.ts";

const station = (number: number, name: string, lat: number, lon: number): Station => ({ id: String(number), number, name, address: "", lat, lon, mechanical: 0, electrical: 0, stands: 0, open: true });
const bellecour = station(2002, "Bellecour / St Exupéry", 45.7578, 4.8320);
const partDieu = station(3001, "Part-Dieu", 45.7606, 4.8594);
const stations = new Map([bellecour, partDieu].map((item) => [item.number, item]));
const finished = {
  id: "3a4b5c6d", status: "FINISHED", bikeNumber: 20449, startDateTime: "2026-03-02T09:32:14", startStation: 2002, endDateTime: "2026-03-02T09:34:34", endStation: 3001,
  startStand: 1, endStand: 12, duration: 3, rewardsEarned: 5, rewardsSpent: 10, price: 180, discount: 80, reducedPrice: 100,
  litigious: true, isSpecial: false, isRated: false, token: "ABCDEFGHIJABCDEFGHIJ", bikeType: 0, origin: 4
};
const trip = (value: unknown) => normalizeTrip(rawTrip.parse(value), stations);

test("haversine measures great-circle metres", () => {
  assert.ok(Math.abs(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111_195) < 1);
  assert.equal(haversine(bellecour, bellecour), 0);
  const across = haversine(bellecour, partDieu);
  assert.ok(across > 2_100 && across < 2_250, String(across));
  assert.equal(across, haversine(partDieu, bellecour));
});

test("a finished trip keeps stands, prices, points, flags and its UTC times", () => {
  const value = trip(finished);
  assert.equal(value.startedAt, "2026-03-02T09:32:14.000Z");
  assert.equal(value.endedAt, "2026-03-02T09:34:34.000Z");
  assert.deepEqual([value.startStation, value.endStation, value.startStationNumber, value.endStationNumber, value.startStand, value.endStand], ["Bellecour / St Exupéry", "Part-Dieu", 2002, 3001, 1, 12]);
  assert.equal(value.distance, Math.round(haversine(bellecour, partDieu)));
  assert.deepEqual([value.price, value.fullPrice, value.discount, value.pointsEarned, value.pointsSpent], [100, 180, 80, 5, 10]);
  assert.deepEqual([value.litigious, value.isRated, value.token, value.origin, value.bikeType], [true, false, "ABCDEFGHIJABCDEFGHIJ", 4, "mechanical"]);
});

test("without a reduced price, the paid amount is the price less the discount", () => {
  assert.equal(trip({ ...finished, reducedPrice: undefined }).price, 100);
  assert.equal(trip({ ...finished, reducedPrice: undefined, discount: undefined }).price, 180);
});

test("a trip back at its start station, or off the station list, has no distance", () => {
  assert.equal(trip({ ...finished, endStation: 2002 }).distance, null);
  const unknown = trip({ ...finished, endStation: 9999 });
  assert.equal(unknown.distance, null);
  assert.equal(unknown.endStation, "Station 9999");
});

test("an anonymised trip and malformed new fields degrade to empty values", () => {
  const value = trip({ id: "x", status: "FINISHED", startDateTime: "2026-03-02T09:32:14", duration: 3, price: 0, litigious: "yes", isRated: "no", token: 12, startStand: "1" });
  assert.deepEqual([value.startStation, value.endStation, value.startStationNumber, value.startStand, value.endStand, value.distance, value.bikeNumber], [null, null, null, null, null, null, null]);
  assert.deepEqual([value.litigious, value.isRated, value.token, value.origin, value.fullPrice, value.discount, value.endedAt], [false, null, null, null, 0, 0, null]);
});

test("a rating is a recommendation without a rating, or a warning rated 30 or 60", () => {
  for (const body of [{ bikeNumber: 20449, recommended: true, rating: null }, { bikeNumber: 20449, recommended: false, rating: 30 }, { bikeNumber: 20449, recommended: false, rating: 60 }]) {
    assert.deepEqual(rateBodySchema.parse(body), body);
  }
  for (const body of [
    { bikeNumber: 20449, recommended: true, rating: 30 }, { bikeNumber: 20449, recommended: false, rating: null }, { bikeNumber: 20449, recommended: false, rating: 50 },
    { bikeNumber: 20449, recommended: true }, { bikeNumber: "20449", recommended: true, rating: null }, { bikeNumber: 0, recommended: true, rating: null },
    { bikeNumber: 1.5, recommended: true, rating: null }, { bikeNumber: 20449, recommended: true, rating: null, contract: "paris" }, null
  ]) assert.equal(rateBodySchema.safeParse(body).success, false, JSON.stringify(body));
});

test("only an unrated finished trip with a bike, ended less than 3 hours ago, can be rated", () => {
  const value = trip(finished);
  const end = Date.parse(value.endedAt!);
  assert.equal(canRate(value, end + 2 * 3_600_000), true);
  assert.equal(canRate(value, end + 3 * 3_600_000), false);
  assert.equal(canRate({ ...value, isRated: true }, end), false);
  assert.equal(canRate({ ...value, isRated: null }, end), false);
  assert.equal(canRate({ ...value, bikeNumber: null }, end), false);
  assert.equal(canRate({ ...value, status: "ERROR" }, end), false);
});

function recorder(status: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return new Response("{}", { status }); }) as typeof fetch;
  return { calls, send };
}
const rating = { accountId: "acc-1", tripId: "trip-1", token: "client", identity: "user" };

test("a rating posts the official body once, with both tokens and a browser agent", async () => {
  const { calls, send } = recorder(200);
  await postRating({ ...rating, body: { bikeNumber: 20449, recommended: false, rating: 30 } }, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.cyclocity.fr/contracts/lyon/accounts/acc-1/trips/trip-1/rate");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Taknv1 client");
  assert.equal(headers.Identity, "user");
  assert.equal(headers["Content-Type"], "application/vnd.trip.v6+json");
  assert.match(headers["User-Agent"], /^Mozilla\//);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { bikeId: 20449, recommended: false, contract: "lyon", rating: 30 });
});

test("a recommendation sends an explicit null rating", async () => {
  const { calls, send } = recorder(200);
  await postRating({ ...rating, body: { bikeNumber: 20449, recommended: true, rating: null } }, send);
  assert.equal(String(calls[0].init.body), '{"bikeId":20449,"recommended":true,"contract":"lyon","rating":null}');
});

test("a refused rating fails without retrying", async () => {
  for (const [status, code] of [[401, "expired"], [404, "unavailable"], [201, "unavailable"], [500, "unavailable"]] as const) {
    const { calls, send } = recorder(status);
    await assert.rejects(postRating({ ...rating, body: { bikeNumber: 20449, recommended: true, rating: null } }, send), (error) => error instanceof VelovError && error.code === code);
    assert.equal(calls.length, 1);
  }
});
