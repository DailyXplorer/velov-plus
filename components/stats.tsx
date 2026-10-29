"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { BicycleIcon, ClockIcon, CoinsIcon, type Icon, LeafIcon, RouteIcon, StarFourIcon } from "./icons";
import { Button, CardTag, EmptyState, SelectField } from "./ui";
import { BikeDrawer } from "./station-bikes";
import { ApiError, getJson } from "./get-json";
import { capitalize, formatDate, formatPrice } from "@/lib/models";
import { type Period, type PeriodStats, type Stats, statsSchema } from "@/lib/stats";

const unavailable = "Vos statistiques sont momentanément indisponibles.";
const periods: { value: Period; label: string; short: string }[] = [
  { value: "30d", label: "30 derniers jours", short: "30 jours" },
  { value: "12m", label: "12 derniers mois", short: "12 mois" },
  { value: "all", label: "Depuis le début", short: "Tout" }
];
const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const number = (value: number) => value.toLocaleString("fr-FR");
const plural = (count: number, word: string) => `${number(count)} ${word}${count > 1 ? "s" : ""}`;
const dayLabel = (day: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => formatDate(`${day}T12:00:00Z`, options);
const monthLabel = (month: string, options: Intl.DateTimeFormatOptions = { month: "short" }) => formatDate(`${month}-15T12:00:00Z`, options);
/** Axis label for a month: its initial only (J F M A…), like Apple Santé; the full month is in the tooltip. */
const monthInitial = (month: string) => monthLabel(month, { month: "narrow" }).toLocaleUpperCase("fr-FR");
const bucketLabel = (unit: "day" | "month", key: string) => unit === "day" ? dayLabel(key, { weekday: "long", day: "numeric", month: "long" }) : monthLabel(key, { month: "long", year: "numeric" });
function hours(minutes: number) {
  return minutes >= 60 ? `${number(Math.floor(minutes / 60))} h ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim() : `${minutes} min`;
}
function kilometres(metres: number) {
  return (metres / 1000).toLocaleString("fr-FR", { maximumFractionDigits: metres < 100_000 ? 1 : 0 });
}

// Fetched once per account and tab: a period change or a return to the page reads nothing.
let cached: { account: string; stats: Stats } | null = null;

export function StatsPage({ account }: { account: string }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; stats: Stats } | { kind: "error"; message: string }>(() => cached?.account === account ? { kind: "ready", stats: cached.stats } : { kind: "loading" });
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const stats = await getJson("/api/stats", statsSchema, unavailable);
      cached = { account, stats };
      setState({ kind: "ready", stats });
    } catch (error) {
      setState({ kind: "error", message: error instanceof ApiError ? error.message : unavailable });
    }
  }, [account]);
  useEffect(() => { if (cached?.account !== account) void load(); }, [account, load]);

  if (state.kind === "loading") return (
    <div className="page-content" aria-busy="true" aria-label="Chargement des statistiques">
      <div className="stat-cards">{[0, 1, 2, 3, 4, 5].map((item) => <div className="skeleton stat-skeleton" key={item}/>)}</div>
      <div className="skeleton skeleton-map"/>
    </div>
  );
  if (state.kind === "error") return <div className="dashboard-error"><p role="alert">{state.message}</p><Button variant="secondary" onClick={() => void load()}>Réessayer</Button></div>;
  return <StatsView stats={state.stats}/>;
}

export function StatsView({ stats }: { stats: Stats }) {
  const [period, setPeriod] = useState<Period>("12m");
  const data = stats.periods[period];
  const ever = stats.periods.all.trips > 0;
  return (
    <div className="page-content stats-page">
      <div className="filter-line">
        <SelectField label="Période" hideLabel value={period} onChange={setPeriod} options={periods}/>
        <span className="result-count">{plural(data.trips, "trajet")}</span>
      </div>
      {!stats.complete ? <p className="inline-notice">Une partie de l’historique n’a pas pu être lue : les chiffres peuvent être incomplets.</p> : null}
      <Headline data={data}/>
      {!data.trips ? (
        <EmptyState>{ever ? "Aucun trajet sur cette période." : "Aucun trajet pour l’instant. Vos statistiques apparaîtront après votre premier trajet."}</EmptyState>
      ) : (
        <>
          <div className="stat-grid">
            <Panel title={data.series.unit === "day" ? "Minutes par jour" : "Minutes par mois"} wide><MinutesChart data={data}/></Panel>
            <Panel title="Type de vélo"><BikeTypes data={data}/></Panel>
            <Panel title="Quand vous roulez" note="Départs par jour et par heure" wide><Heatmap data={data}/></Panel>
            <Panel title="Durée des trajets" note="En minutes"><Durations data={data}/></Panel>
            <Panel title="Évolution des points" note={stats.pointsAvailable ? "Solde en fin de période" : undefined} full><PointsChart data={data} available={stats.pointsAvailable}/></Panel>
            <Panel title="Records" full><Records data={data}/></Panel>
          </div>
          <div className="stat-grid stat-lists">
            <Panel title="Stations de départ"><Ranking items={data.starts.map((item) => ({ label: item.name, count: item.count }))}/></Panel>
            <Panel title="Stations d’arrivée"><Ranking items={data.ends.map((item) => ({ label: item.name, count: item.count }))}/></Panel>
            <Panel title="Trajets favoris"><Ranking items={data.pairs.map((item) => ({ label: item.from === item.to ? `${item.from} (boucle)` : `${item.from} → ${item.to}`, count: item.count }))} empty="Aucun trajet refait deux fois."/></Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Headline({ data }: { data: PeriodStats }) {
  const { distance } = data;
  const kg = data.co2Grams / 1000;
  return (
    <>
      <div className="stat-cards">
        <StatCard icon={BicycleIcon} label="Trajets" value={number(data.trips)} detail={data.trips ? `${hours(Math.round(data.minutes / data.trips))} en moyenne` : "Aucun trajet"}/>
        <StatCard icon={ClockIcon} label="Minutes à vélo" value={number(data.minutes)} detail={data.minutes >= 60 ? `Soit ${hours(data.minutes)}` : "Moins d’une heure"}/>
        <StatCard icon={RouteIcon} label="Km estimés" value={kilometres(distance.metres)} detail={`Sur ${plural(distance.known, "trajet")}`}/>
        <StatCard icon={LeafIcon} label="CO₂ évité estimé" value={kg >= 1 ? kg.toLocaleString("fr-FR", { maximumFractionDigits: kg < 10 ? 1 : 0 }) : number(data.co2Grams)} unit={kg >= 1 ? "kg" : "g"} detail="Face à la voiture"/>
        <StatCard icon={CoinsIcon} label="Dépenses" value={formatPrice(data.spentCents)} detail={data.savedCents ? `${formatPrice(data.savedCents)} économisés` : data.spentCents ? "Aucune réduction" : "Trajets compris"}/>
        <StatCard icon={StarFourIcon} label="Points gagnés" value={number(data.pointsEarned)} detail="Trajets, notes et bonus"/>
      </div>
    </>
  );
}

function StatCard({ icon, label, value, unit, detail }: { icon: Icon; label: string; value: string; unit?: string; detail: string }) {
  return (
    <div className="summary-card stat-card">
      <CardTag icon={icon}>{label}</CardTag>
      <strong className="metric-value">{value}{unit ? <span className="metric-unit">{unit}</span> : null}</strong>
      <span className="metric-detail">{detail}</span>
    </div>
  );
}

function Panel({ title, note, wide = false, full = false, children }: { title: string; note?: string; wide?: boolean; full?: boolean; children: ReactNode }) {
  return (
    <section className={`stat-panel${wide ? " is-wide" : ""}${full ? " is-full" : ""}`}>
      <div className="stat-panel-heading"><h2>{title}</h2>{note ? <span className="metric-label">{note}</span> : null}</div>
      {children}
    </section>
  );
}

/** The chart's width in CSS pixels, so the SVG is drawn at its real size: crisp text, round bars. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(Math.round(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

type Tip = { x: number; y: number; content: ReactNode };

/**
 * Hover with a mouse, tap with a finger: `hit` turns a point into a datum, `tip` places its tooltip.
 * The SVG is one image for screen readers; its numbers are in the hidden table instead.
 */
function Chart({ label, height, table, hit, tip, children }: {
  label: string; height: number | ((width: number) => number); table: ReactNode;
  hit: (x: number, y: number, width: number) => number | null;
  tip: (index: number, width: number) => Tip;
  children: (width: number, active: number | null) => ReactNode;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (active == null) return;
    const outside = (event: globalThis.PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setActive(null); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [active, ref]);
  function point(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setActive(hit(event.clientX - box.left, event.clientY - box.top, width));
  }
  const shown = active != null && width ? tip(active, width) : null;
  const pixels = typeof height === "number" ? height : width ? height(width) : 0;
  const edge = shown ? shown.x < 70 ? " is-start" : shown.x > width - 70 ? " is-end" : "" : "";
  return (
    <div className="chart" ref={ref} style={{ height: pixels || undefined }} onPointerMove={point} onPointerDown={point}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") setActive(null); }}>
      {width ? <svg width={width} height={pixels} role="img" aria-label={label}>{children(width, active)}</svg> : null}
      {shown ? <div className={`chart-tip${edge}`} style={{ left: shown.x, top: shown.y }} aria-hidden="true">{shown.content}</div> : null}
      <div className="sr-only"><table>{table}</table></div>
    </div>
  );
}

/** 0, then a round half and top: 47 -> 25, 50. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(value));
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((factor) => factor * step).find((candidate) => candidate >= value) ?? value);
}

type Bar = { label: string; value: number; tip: ReactNode; axis?: string };
const AXIS = 34;
const BASE = 24;

function BarChart({ bars, label, caption, unit, height = 190 }: { bars: Bar[]; label: string; caption: string; unit: string; height?: number }) {
  const top = niceMax(Math.max(...bars.map((bar) => bar.value)));
  const inner = (width: number) => width - AXIS;
  const band = (width: number) => inner(width) / bars.length;
  const chartHeight = height - BASE - 8;
  return (
    <Chart label={label} height={height}
      hit={(x, _y, width) => { const index = Math.floor((x - AXIS) / band(width)); return index >= 0 && index < bars.length ? index : null; }}
      tip={(index, width) => ({ x: AXIS + band(width) * (index + .5), y: 8 + chartHeight * (1 - bars[index].value / top), content: bars[index].tip })}
      table={<><caption>{caption}</caption><thead><tr><th scope="col">Période</th><th scope="col">{unit}</th></tr></thead><tbody>{bars.map((bar) => <tr key={bar.label}><th scope="row">{bar.label}</th><td>{bar.value}</td></tr>)}</tbody></>}>
      {(width, active) => {
        const step = band(width);
        const barWidth = Math.max(2, Math.min(step * .68, 40));
        const every = Math.max(1, Math.ceil(bars.length * 38 / inner(width)));
        return (
          <>
            {[0, .5, 1].map((share) => {
              const y = 8 + chartHeight * (1 - share);
              return <g key={share}><line className="chart-grid" x1={AXIS} x2={width} y1={y} y2={y}/><text className="chart-axis" x={AXIS - 8} y={y + 3.5} textAnchor="end">{number(Math.round(top * share))}</text></g>;
            })}
            {bars.map((bar, index) => {
              const barHeight = chartHeight * bar.value / top;
              const x = AXIS + step * index + (step - barWidth) / 2;
              return (
                <g key={bar.label}>
                  {bar.value ? <rect className={`chart-bar${active === index ? " is-active" : ""}`} x={x} y={8 + chartHeight - barHeight} width={barWidth} height={barHeight} rx={Math.min(3, barWidth / 2)}/> : null}
                  {(bars.length - 1 - index) % every === 0 ? <text className="chart-axis" x={x + barWidth / 2} y={height - 6} textAnchor="middle">{bar.axis ?? bar.label}</text> : null}
                </g>
              );
            })}
          </>
        );
      }}
    </Chart>
  );
}

function MinutesChart({ data }: { data: PeriodStats }) {
  const { unit, buckets } = data.series;
  const bars = buckets.map((bucket) => ({
    label: bucketLabel(unit, bucket.key), value: bucket.minutes,
    axis: unit === "day" ? dayLabel(bucket.key, { day: "numeric", month: "numeric" }) : monthInitial(bucket.key),
    tip: <><strong>{capitalize(bucketLabel(unit, bucket.key))}</strong><span>{hours(bucket.minutes)} · {plural(bucket.trips, "trajet")}</span></>
  }));
  return <BarChart bars={bars} unit="Minutes" caption={unit === "day" ? "Minutes à vélo par jour" : "Minutes à vélo par mois"}
    label={`Minutes à vélo par ${unit === "day" ? "jour" : "mois"}, ${hours(data.minutes)} au total`}/>;
}

function Durations({ data }: { data: PeriodStats }) {
  const bars = data.durations.map((bucket) => ({
    label: `${bucket.label} min`, axis: bucket.label, value: bucket.count,
    tip: <><strong>{bucket.label === "30+" ? "30 min et plus" : `De ${bucket.label.replace("-", " à ")} min`}</strong><span>{plural(bucket.count, "trajet")}</span></>
  }));
  return <BarChart bars={bars} unit="Trajets" caption="Nombre de trajets par durée" label={`Durée des trajets, la plus fréquente ${[...bars].sort((left, right) => right.value - left.value)[0].label}`}/>;
}

function Heatmap({ data }: { data: PeriodStats }) {
  const rows = data.heatmap;
  const max = Math.max(1, ...rows.flat());
  const left = 20;
  const gap = 2;
  const cellHeight = (width: number) => Math.min(22, Math.max(12, (width - left) / 24));
  const busiest = rows.flatMap((row, day) => row.map((count, hour) => ({ day, hour, count }))).sort((one, other) => other.count - one.count)[0];
  return (
    <Chart label={`Départs par jour et par heure. Créneau le plus fréquent : ${WEEKDAYS[busiest.day].toLowerCase()} de ${busiest.hour} h à ${busiest.hour + 1} h`} height={(width) => 7 * cellHeight(width) + 20}
        hit={(x, y, width) => {
          const column = Math.floor((x - left) / ((width - left) / 24));
          const row = Math.floor(y / cellHeight(width));
          return column >= 0 && column < 24 && row >= 0 && row < 7 ? row * 24 + column : null;
        }}
        tip={(index, width) => {
          const [day, hour] = [Math.floor(index / 24), index % 24];
          return { x: left + (width - left) / 24 * (hour + .5), y: day * cellHeight(width), content: <><strong>{WEEKDAYS[day]}, {hour} h - {hour + 1} h</strong><span>{plural(rows[day][hour], "départ")}</span></> };
        }}
        table={<><caption>Départs par jour de la semaine et par heure</caption><thead><tr><th scope="col">Jour</th>{rows[0].map((_, hour) => <th scope="col" key={hour}>{hour} h</th>)}</tr></thead><tbody>{rows.map((row, day) => <tr key={day}><th scope="row">{WEEKDAYS[day]}</th>{row.map((count, hour) => <td key={hour}>{count}</td>)}</tr>)}</tbody></>}>
        {(width, active) => {
          const cellWidth = (width - left) / 24;
          const cell = cellHeight(width);
          return (
            <>
              {rows.map((row, day) => (
                <g key={day}>
                  <text className="chart-axis" x={0} y={day * cell + cell / 2 + 3.5}>{WEEKDAYS[day].charAt(0)}</text>
                  {row.map((count, hour) => (
                    <rect key={hour} className={`heat-cell${count ? "" : " is-empty"}${active === day * 24 + hour ? " is-active" : ""}`} x={left + hour * cellWidth + gap / 2} y={day * cell + gap / 2}
                      width={cellWidth - gap} height={cell - gap} rx={3} fillOpacity={count ? .18 + .82 * count / max : 1}/>
                  ))}
                </g>
              ))}
              {[0, 6, 12, 18, 23].map((hour) => <text key={hour} className="chart-axis" x={left + cellWidth * (hour + .5)} y={7 * cell + 14} textAnchor="middle">{hour} h</text>)}
            </>
          );
        }}
    </Chart>
  );
}

function BikeTypes({ data }: { data: PeriodStats }) {
  const total = data.trips;
  const parts = [
    { key: "electrical", label: "Électrique", count: data.bikeTypes.electrical },
    { key: "mechanical", label: "Mécanique", count: data.bikeTypes.mechanical },
    { key: "unknown", label: "Non renseigné", count: data.bikeTypes.unknown }
  ].filter((part) => part.count > 0);
  const size = 168;
  const stroke = 24;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = (count: number) => `${Math.round(count / total * 100)}${" "}%`;
  return (
    <div className="donut">
      <div className="donut-chart" style={{ width: size }}><Chart label={`Répartition par type de vélo : ${parts.map((part) => `${part.label.toLowerCase()} ${share(part.count)}`).join(", ")}`} height={size}
        hit={(x, y) => {
          const [dx, dy] = [x - size / 2, y - size / 2];
          const distance = Math.hypot(dx, dy);
          if (distance < radius - stroke / 2 || distance > radius + stroke / 2) return null;
          const turn = ((Math.atan2(dy, dx) + Math.PI / 2) / (2 * Math.PI) + 1) % 1;
          let start = 0;
          return parts.findIndex((part) => { start += part.count / total; return turn < start; });
        }}
        tip={(index) => {
          const before = parts.slice(0, index).reduce((sum, part) => sum + part.count, 0);
          const angle = ((before + parts[index].count / 2) / total) * 2 * Math.PI - Math.PI / 2;
          return { x: size / 2 + Math.cos(angle) * radius, y: size / 2 + Math.sin(angle) * radius - 8, content: <><strong>{parts[index].label}</strong><span>{plural(parts[index].count, "trajet")} · {share(parts[index].count)}</span></> };
        }}
        table={<><caption>Trajets par type de vélo</caption><tbody>{parts.map((part) => <tr key={part.key}><th scope="row">{part.label}</th><td>{part.count}</td></tr>)}</tbody></>}>
        {(_width, active) => {
          let offset = 0;
          return <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {parts.map((part, index) => {
              const length = part.count / total * circumference;
              const segment = <circle key={part.key} className={`donut-part is-${part.key}${active === index ? " is-active" : ""}`} cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke}
                strokeDasharray={`${Math.max(0, length - (parts.length > 1 ? 2 : 0))} ${circumference}`} strokeDashoffset={-offset}/>;
              offset += length;
              return segment;
            })}
          </g>;
        }}
      </Chart></div>
      <ul className="donut-legend">
        {parts.map((part) => <li key={part.key}><span className={`legend-dot is-${part.key}`}/><span>{part.label}</span><strong>{share(part.count)}</strong></li>)}
      </ul>
    </div>
  );
}

function PointsChart({ data, available }: { data: PeriodStats; available: boolean }) {
  const { unit, buckets } = data.series;
  if (!available) return <EmptyState>L’historique des points est momentanément indisponible.</EmptyState>;
  const values = buckets.map((bucket) => bucket.balance ?? 0);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(1, high - low);
  const height = 190;
  const plot = height - BASE - 16;
  const x = (index: number, width: number) => AXIS + (buckets.length > 1 ? index / (buckets.length - 1) : .5) * (width - AXIS - 8);
  const y = (value: number) => 12 + plot * (1 - (value - low) / span);
  const every = (width: number) => Math.max(1, Math.ceil(buckets.length * 38 / (width - AXIS)));
  return (
    <Chart label={`Solde de points, de ${number(values[0])} à ${number(values.at(-1)!)}`} height={height}
      hit={(pointer, _y, width) => Math.max(0, Math.min(buckets.length - 1, Math.round((pointer - AXIS) / (width - AXIS - 8) * (buckets.length - 1))))}
      tip={(index, width) => ({ x: x(index, width), y: y(values[index]) - 6, content: <><strong>{capitalize(bucketLabel(unit, buckets[index].key))}</strong><span>{plural(values[index], "point")}</span></> })}
      table={<><caption>Solde de points par {unit === "day" ? "jour" : "mois"}</caption><thead><tr><th scope="col">Période</th><th scope="col">Points</th></tr></thead><tbody>{buckets.map((bucket, index) => <tr key={bucket.key}><th scope="row">{bucketLabel(unit, bucket.key)}</th><td>{values[index]}</td></tr>)}</tbody></>}>
      {(width, active) => {
        const line = values.map((value, index) => `${x(index, width).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
        return (
          <>
            {[low, high].map((value) => <g key={value}><line className="chart-grid" x1={AXIS} x2={width} y1={y(value)} y2={y(value)}/><text className="chart-axis" x={AXIS - 8} y={y(value) + 3.5} textAnchor="end">{number(value)}</text></g>)}
            <polyline className="chart-line" points={line}/>
            {buckets.map((bucket, index) => (buckets.length - 1 - index) % every(width) === 0
              ? <text key={bucket.key} className="chart-axis" x={x(index, width)} y={height - 6} textAnchor="middle">{unit === "day" ? dayLabel(bucket.key, { day: "numeric", month: "numeric" }) : monthInitial(bucket.key)}</text> : null)}
            {active != null ? <><line className="chart-cursor" x1={x(active, width)} x2={x(active, width)} y1={12} y2={12 + plot}/><circle className="chart-dot" cx={x(active, width)} cy={y(values[active])} r={4.5}/></> : null}
          </>
        );
      }}
    </Chart>
  );
}

function Records({ data }: { data: PeriodStats }) {
  const { longest, busiestDay, streak, bike } = data.records;
  const [bikeOpen, setBikeOpen] = useState(false);
  const route = longest?.from && longest.to ? longest.from === longest.to ? longest.from : `${longest.from} → ${longest.to}` : null;
  return (
    <dl className="stat-records">
      <div><dt>Plus long trajet</dt><dd><strong>{longest ? hours(longest.minutes) : "—"}</strong>{longest ? <small>{[longest.startedAt ? formatDate(longest.startedAt, { day: "numeric", month: "long", year: "numeric" }) : null, route].filter(Boolean).join(" · ")}</small> : null}</dd></div>
      <div><dt>Jour le plus actif</dt><dd><strong>{busiestDay ? plural(busiestDay.trips, "trajet") : "—"}</strong>{busiestDay ? <small>{capitalize(dayLabel(busiestDay.day, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</small> : null}</dd></div>
      <div><dt>Série de jours consécutifs</dt><dd><strong>{streak ? plural(streak.days, "jour") : "—"}</strong>{streak && streak.days > 1 ? <small>Du {dayLabel(streak.from, { day: "numeric", month: "long" })} au {dayLabel(streak.to, { day: "numeric", month: "long", year: "numeric" })}</small> : null}</dd></div>
      <div><dt>Vélo le plus emprunté</dt><dd>{bike ? <><button className="stat-bike" onClick={() => setBikeOpen(true)} aria-label={`Voir la fiche du vélo ${bike.number}`}>N° {bike.number}</button><small>{plural(bike.count, "trajet")}{bike.type === "electrical" ? " · Électrique" : bike.type === "mechanical" ? " · Mécanique" : ""}</small></> : <strong>—</strong>}</dd></div>
      {bikeOpen && bike ? <BikeDrawer number={bike.number} onClose={() => setBikeOpen(false)}/> : null}
    </dl>
  );
}

function Ranking({ items, empty = "Aucune station renseignée." }: { items: { label: string; count: number }[]; empty?: string }) {
  if (!items.length) return <EmptyState>{empty}</EmptyState>;
  const max = items[0].count;
  return (
    <ol className="stat-ranking">
      {items.map((item) => (
        <li key={item.label}>
          <span className="stat-ranking-label" title={item.label}>{item.label}</span>
          <span className="stat-ranking-count">{number(item.count)}</span>
          <span className="stat-ranking-bar" aria-hidden="true"><span style={{ width: `${item.count / max * 100}%` }}/></span>
        </li>
      ))}
    </ol>
  );
}
