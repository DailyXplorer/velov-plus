export type Point = { lat: number; lon: number };

export function haversine(from: Point, to: Point) {
  const radians = Math.PI / 180;
  const latitude = (to.lat - from.lat) * radians;
  const longitude = (to.lon - from.lon) * radians;
  const arc = Math.sin(latitude / 2) ** 2 + Math.cos(from.lat * radians) * Math.cos(to.lat * radians) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

export function formatDistance(metres: number) {
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `${(metres / 1000).toLocaleString("fr-FR", { maximumFractionDigits: metres < 10_000 ? 1 : 0 })} km`;
}

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;
export const QUICK_FIX: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 };
export const PRECISE_FIX: PositionOptions = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 };

type Locator = Pick<Geolocation, "getCurrentPosition">;
type PositionFailure = Pick<GeolocationPositionError, "code" | "message">;

function attempt(geolocation: Locator, options: PositionOptions) {
  return new Promise<GeolocationPosition>((resolve, reject) => geolocation.getCurrentPosition(resolve, reject, options));
}

export async function findPosition(geolocation: Locator) {
  try {
    return await attempt(geolocation, QUICK_FIX);
  } catch (error) {
    const { code } = error as PositionFailure;
    if (code !== TIMEOUT && code !== POSITION_UNAVAILABLE) throw error;
    return attempt(geolocation, PRECISE_FIX);
  }
}

function failureMessage(code: number) {
  if (code === PERMISSION_DENIED) return "Localisation refusée. Autorisez-la pour ce site dans votre navigateur, puis dans les réglages de localisation de votre appareil.";
  if (code === POSITION_UNAVAILABLE) return "Votre appareil ne trouve pas votre position. Vérifiez que le service de localisation est activé pour ce navigateur.";
  if (code === TIMEOUT) return "La localisation a pris trop de temps. Réessayez.";
  return "Impossible de vous localiser pour le moment.";
}

export function shortAgent(userAgent: string) {
  const browser = /Edg/.test(userAgent) ? "Edge" : /OPR|Opera/.test(userAgent) ? "Opera" : /SamsungBrowser/.test(userAgent) ? "Samsung Internet"
    : /Firefox|FxiOS/.test(userAgent) ? "Firefox" : /Chrome|CriOS/.test(userAgent) ? "Chrome" : /Safari/.test(userAgent) ? "Safari" : "Navigateur inconnu";
  const system = /iPhone|iPad|iPod/.test(userAgent) ? "iOS" : /Android/.test(userAgent) ? "Android" : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /Windows/.test(userAgent) ? "Windows" : /CrOS/.test(userAgent) ? "ChromeOS" : /Linux/.test(userAgent) ? "Linux" : "système inconnu";
  return `${browser} ${system}`;
}

type Browser = { userAgent: string; permissions?: Pick<Permissions, "query"> };

export async function describeLocationFailure(error: unknown, browser: Browser) {
  const { code, message } = (error ?? {}) as Partial<PositionFailure>;
  const permission = await Promise.resolve().then(() => browser.permissions?.query({ name: "geolocation" })).then((status) => status?.state, () => undefined);
  const raw = [`Code ${code ?? "—"}`, message || "—", shortAgent(browser.userAgent), permission && `Permission ${permission}`].filter(Boolean).join(" · ");
  return { message: failureMessage(code ?? 0), raw };
}
