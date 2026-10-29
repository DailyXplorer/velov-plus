"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { BicycleIcon, ClockIcon, CoinsIcon, type Icon, LeafIcon, RouteIcon, StarFourIcon } from "./icons";
import { Button, CardTag, EmptyState, Ghost, SelectField, SelectSkeleton } from "./ui";
import { BikeDrawer } from "./station-bikes";
import { ApiError, getJson } from "./get-json";
import { capitalize, formatCountSans, formatDate, formatPrice } from "@/lib/models";
import { type Period, type PeriodStats, type Stats, createStatsCache, statsSchema } from "@/lib/stats";

const unavailable = "Vos statistiques sont momentanément indisponibles.";
const periods: { value: Period; label: string }[] = [
  { value: "30d", label: "30 derniers jours" },
  { value: "12m", label: "12 derniers mois" },
  { value: "all", label: "Depuis le début" }
];
const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const figure = (value: number) => value.toLocaleString("fr-FR");
const plural = (count: number, word: string, format = formatCountSans) => `${format(count)} ${word}${count > 1 ? "s" : ""}`;
const dayLabel = (day: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => formatDate(`${day}T12:00:00Z`, options);
const monthLabel = (month: string, options: Intl.DateTimeFormatOptions = { month: "short" }) => formatDate(`${month}-15T12:00:00Z`, options);
const monthInitial = (month: string) => monthLabel(month, { month: "narrow" }).toLocaleUpperCase("fr-FR");
const bucketLabel = (unit: "day" | "month", key: string) => unit === "day" ? dayLabel(key, { weekday: "long", day: "numeric", month: "long" }) : monthLabel(key, { month: "long", year: "numeric" });
function hours(minutes: number, format = formatCountSans) {
  return minutes >= 60 ? `${format(Math.floor(minutes / 60))} h ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim() : `${minutes} min`;
}
function kilometres(metres: number) {
  return (metres / 1000).toLocaleString("fr-FR", { maximumFractionDigits: metres < 100_000 ? 1 : 0 });
}

const cache = createStatsCache();
export const forgetStats = () => cache.clear();

export function StatsPage({ account }: { account: string }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; stats: Stats } | { kind: "error"; message: string }>(() => {
    const stats = cache.get(account);
    return stats ? { kind: "ready", stats } : { kind: "loading" };
  });
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const stats = await getJson("/api/stats", statsSchema, unavailable);
      if (stats.complete) cache.set(account, stats); else cache.clear();
      setState({ kind: "ready", stats });
    } catch (error) {
      setState({ kind: "error", message: error instanceof ApiError ? error.message : unavailable });
    }
  }, [account]);
  useEffect(() => { if (!cache.get(account)) void load(); }, [account, load]);

  if (state.kind === "loading") return <StatsSkeleton/>;
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
      </div>
      {!stats.complete ? <small className="soon-note" role="status">Historique partiel</small> : null}
      <Headline data={data} balance={stats.balance}/>
      {!data.trips ? (
        <EmptyState>{ever ? "Aucun trajet sur cette période." : "Vos statistiques apparaîtront après votre premier trajet."}</EmptyState>
      ) : (
        <div className="stat-grid">
          <Panel title={data.series.unit === "day" ? "Temps à vélo par jour" : "Temps à vélo par mois"} full><MinutesChart data={data}/></Panel>
          <Panel title="Horaires de départ" wide><Heatmap data={data}/></Panel>
          <Panel title="Répartition par type de vélo"><BikeTypes data={data}/></Panel>
          <Panel title="Records" full><Records data={data}/></Panel>
          {data.stations.length ? <Panel title="Stations les plus utilisées" full><Ranking items={data.stations}/></Panel> : null}
        </div>
      )}
    </div>
  );
}

const HEADLINES: { icon: Icon; label: string; value: string; unit?: string }[] = [
  { icon: BicycleIcon, label: "Trajets", value: "0" }, { icon: ClockIcon, label: "Minutes à vélo", value: "0" },
  { icon: RouteIcon, label: "Distance", value: "0", unit: "km" }, { icon: LeafIcon, label: "CO₂ évité", value: "0", unit: "kg" },
  { icon: CoinsIcon, label: "Dépenses", value: "0,00 €" }, { icon: StarFourIcon, label: "Points gagnés", value: "0" }
];
const GHOST_STATIONS = ["Bellecour", "Part-Dieu Villette", "Hôtel de Ville", "Saxe-Gambetta", "Croix-Rousse"];

export function StatsSkeleton() {
  return (
    <div className="page-content stats-page" aria-busy="true" aria-label="Chargement des statistiques">
      <div className="filter-line"><SelectSkeleton options={periods}/></div>
      <div className="stat-cards" aria-hidden="true">
        {HEADLINES.map((card) => <StatCard key={card.label} {...card} detail="—" skeleton/>)}
      </div>
      <div className="stat-grid">
        <Panel title="Temps à vélo par mois" full><ChartSkeleton height={BAR_HEIGHT} plotTop={PLOT_TOP}/></Panel>
        <Panel title="Horaires de départ" wide><ChartSkeleton height={heatmapHeight} plotTop={HEAT_TOP}/></Panel>
        <Panel title="Répartition par type de vélo">
          <div className="donut">
            <div className="donut-chart" style={{ width: DONUT }}><ChartSkeleton height={DONUT} className="donut-skeleton"/></div>
            <ul className="donut-legend">{["Électrique", "Mécanique"].map((label) => <li key={label}><span className="legend-dot skeleton"/><Ghost>{label}</Ghost><strong><Ghost>50 %</Ghost></strong></li>)}</ul>
          </div>
        </Panel>
        <Panel title="Records" full>
          <dl className="stat-records">{["Plus long trajet", "Jour record", "Série", "Vélo favori"].map((label) => <div key={label}><dt>{label}</dt><dd><Ghost>12 min</Ghost></dd></div>)}</dl>
        </Panel>
        <Panel title="Stations les plus utilisées" full>
          <ol className="stat-ranking">{GHOST_STATIONS.map((name) => <li key={name}><span className="stat-ranking-label"><Ghost>{name}</Ghost></span><span className="stat-ranking-count"><Ghost>12</Ghost></span></li>)}</ol>
        </Panel>
      </div>
    </div>
  );
}

function ChartSkeleton({ height, plotTop = 0, className = "" }: { height: number | ((width: number) => number); plotTop?: number; className?: string }) {
  const [ref, width] = useWidth();
  const pixels = typeof height === "number" ? height : width ? height(width) : 0;
  return <div className={`chart skeleton ${className}`} ref={ref} style={{ height: pixels || undefined, marginTop: PLOT_GAP - plotTop }} aria-hidden="true"/>;
}

function Headline({ data, balance }: { data: PeriodStats; balance: number | null }) {
  const kg = data.co2Grams / 1000;
  return (
    <div className="stat-cards">
      <StatCard icon={BicycleIcon} label="Trajets" value={figure(data.trips)} detail={data.trips ? `${hours(Math.round(data.minutes / data.trips))} en moyenne` : "Aucun trajet"}/>
      <StatCard icon={ClockIcon} label="Minutes à vélo" value={figure(data.minutes)} detail={data.minutes >= 60 ? `Soit ${hours(data.minutes)}` : "Moins d’une heure"}/>
      <StatCard icon={RouteIcon} label="Distance" value={kilometres(data.distance.metres)} unit="km" detail={`Sur ${plural(data.distance.known, "trajet")}`}/>
      <StatCard icon={LeafIcon} label="CO₂ évité" value={kg >= 1 ? kg.toLocaleString("fr-FR", { maximumFractionDigits: kg < 10 ? 1 : 0 }) : figure(data.co2Grams)} unit={kg >= 1 ? "kg" : "g"} detail="Plutôt qu’en voiture"/>
      <StatCard icon={CoinsIcon} label="Dépenses" value={formatPrice(data.spentCents)} detail={data.savedCents ? `${formatPrice(data.savedCents)} économisés` : data.spentCents ? "Aucune réduction" : "Aucun supplément"}/>
      <StatCard icon={StarFourIcon} label="Points gagnés" value={figure(data.pointsEarned)} detail={balance != null ? `Solde de ${plural(balance, "point")}` : undefined}/>
    </div>
  );
}

function StatCard({ icon, label, value, unit, detail, skeleton = false }: { icon: Icon; label: string; value: string; unit?: string; detail?: string; skeleton?: boolean }) {
  return (
    <div className={`summary-card stat-card${skeleton ? " skeleton" : ""}`}>
      <CardTag icon={icon}>{label}</CardTag>
      <strong className="metric-value">{value}{unit ? <span className="metric-unit">{unit}</span> : null}</strong>
      {detail ? <span className="metric-detail">{detail}</span> : null}
    </div>
  );
}

function Panel({ title, wide = false, full = false, children }: { title: string; wide?: boolean; full?: boolean; children: ReactNode }) {
  return (
    <section className={`stat-panel${wide ? " is-wide" : ""}${full ? " is-full" : ""}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

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

type Tip = { x: number; content: ReactNode };
const TIP_GAP = 6;
const PLOT_GAP = 16;

function placeTip(tip: HTMLElement, chart: HTMLElement, x: number, plotTop: number) {
  const card = chart.closest<HTMLElement>(".stat-panel") ?? chart;
  const style = getComputedStyle(card);
  const bounds = card.getBoundingClientRect();
  const own = chart.getBoundingClientRect();
  const min = bounds.left + parseFloat(style.paddingLeft) - own.left;
  const max = bounds.right - parseFloat(style.paddingRight) - own.left;
  tip.style.maxWidth = `${max - min}px`;
  const size = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(Math.max(x - size.width / 2, min), max - size.width)}px`;
  tip.style.top = `${Math.max(plotTop - TIP_GAP - size.height, bounds.top + parseFloat(style.paddingTop) - own.top)}px`;
}

function Chart({ label, height, plotTop = 0, table, hit, tip, children }: {
  label: string; height: number | ((width: number) => number); plotTop?: number; table: ReactNode;
  hit: (x: number, y: number, width: number) => number | null;
  tip: (index: number, width: number) => Tip;
  children: (width: number, active: number | null) => ReactNode;
}) {
  const [ref, width] = useWidth();
  const tipRef = useRef<HTMLDivElement>(null);
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
  useLayoutEffect(() => {
    if (tipRef.current && ref.current && shown) placeTip(tipRef.current, ref.current, shown.x, plotTop);
  });
  return (
    <div className="chart" ref={ref} style={{ height: pixels || undefined, marginTop: PLOT_GAP - plotTop }} onPointerMove={point} onPointerDown={point}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") setActive(null); }}>
      {width ? <svg width={width} height={pixels} role="img" aria-label={label}>{children(width, active)}</svg> : null}
      {shown ? <div className="chart-tip" ref={tipRef} aria-hidden="true">{shown.content}</div> : null}
      <div className="sr-only"><table>{table}</table></div>
    </div>
  );
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(value));
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((factor) => factor * step).find((candidate) => candidate >= value) ?? value);
}

type Bar = { label: string; value: number; tip: ReactNode; axis?: string };
const AXIS = 34;
const BASE = 24;
const BAR_HEIGHT = 220;
const PLOT_TOP = 8;

function BarChart({ bars, label, caption, unit, height = BAR_HEIGHT }: { bars: Bar[]; label: string; caption: string; unit: string; height?: number }) {
  const top = niceMax(Math.max(...bars.map((bar) => bar.value)));
  const inner = (width: number) => width - AXIS;
  const axisSpacing = Math.max(...bars.map((bar) => (bar.axis ?? bar.label).length)) * 7 + 10;
  const band = (width: number) => inner(width) / bars.length;
  const chartHeight = height - BASE - PLOT_TOP;
  return (
    <Chart label={label} height={height} plotTop={PLOT_TOP}
      hit={(x, _y, width) => { const index = Math.floor((x - AXIS) / band(width)); return index >= 0 && index < bars.length ? index : null; }}
      tip={(index, width) => ({ x: AXIS + band(width) * (index + .5), content: bars[index].tip })}
      table={<><caption>{caption}</caption><thead><tr><th scope="col">Période</th><th scope="col">{unit}</th></tr></thead><tbody>{bars.map((bar) => <tr key={bar.label}><th scope="row">{bar.label}</th><td>{bar.value}</td></tr>)}</tbody></>}>
      {(width, active) => {
        const step = band(width);
        const barWidth = Math.max(2, Math.min(step * .68, 40));
        const every = Math.max(1, Math.ceil(bars.length * axisSpacing / inner(width)));
        return (
          <>
            {[0, .5, 1].map((share) => {
              const y = PLOT_TOP + chartHeight * (1 - share);
              return <g key={share}><line className="chart-grid" x1={AXIS} x2={width} y1={y} y2={y}/><text className="chart-axis" x={AXIS - 8} y={y + 3.5} textAnchor="end">{formatCountSans(Math.round(top * share))}</text></g>;
            })}
            {bars.map((bar, index) => {
              const barHeight = chartHeight * bar.value / top;
              const x = AXIS + step * index + (step - barWidth) / 2;
              return (
                <g key={bar.label}>
                  {bar.value ? <rect className={`chart-bar${active === index ? " is-active" : ""}`} x={x} y={PLOT_TOP + chartHeight - barHeight} width={barWidth} height={barHeight} rx={Math.min(3, barWidth / 2)}/> : null}
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
    tip: <><strong>{capitalize(bucketLabel(unit, bucket.key))}</strong><span>{hours(bucket.minutes)} en {plural(bucket.trips, "trajet")}</span></>
  }));
  return <BarChart bars={bars} unit="Minutes" caption={unit === "day" ? "Temps à vélo par jour" : "Temps à vélo par mois"}
    label={`Temps à vélo par ${unit === "day" ? "jour" : "mois"}, ${hours(data.minutes)} au total`}/>;
}

const HEAT_LEFT = 20;
const RADIUS = 3;
const HEAT_GAP = 2;
const HEAT_TOP = HEAT_GAP / 2;
const cellHeight = (width: number) => Math.min(26, Math.max(12, (width - HEAT_LEFT) / 24));
const heatmapHeight = (width: number) => 7 * cellHeight(width) + 20;

function Heatmap({ data }: { data: PeriodStats }) {
  const rows = data.heatmap;
  const max = Math.max(1, ...rows.flat());
  const left = HEAT_LEFT;
  const gap = HEAT_GAP;
  const busiest = rows.flatMap((row, day) => row.map((count, hour) => ({ day, hour, count }))).sort((one, other) => other.count - one.count)[0];
  return (
    <Chart label={`Départs selon le jour et l’heure, le plus souvent le ${WEEKDAYS[busiest.day].toLowerCase()} entre ${busiest.hour} h et ${busiest.hour + 1} h`} height={heatmapHeight} plotTop={HEAT_TOP}
        hit={(x, y, width) => {
          const column = Math.floor((x - left) / ((width - left) / 24));
          const row = Math.floor(y / cellHeight(width));
          return column >= 0 && column < 24 && row >= 0 && row < 7 ? row * 24 + column : null;
        }}
        tip={(index, width) => {
          const [day, hour] = [Math.floor(index / 24), index % 24];
          return { x: left + (width - left) / 24 * (hour + .5), content: <><strong>{WEEKDAYS[day]}, de {hour} h à {hour + 1} h</strong><span>{plural(rows[day][hour], "départ")}</span></> };
        }}
        table={<><caption>Départs selon le jour et l’heure</caption><thead><tr><th scope="col">Jour</th>{rows[0].map((_, hour) => <th scope="col" key={hour}>{hour} h</th>)}</tr></thead><tbody>{rows.map((row, day) => <tr key={day}><th scope="row">{WEEKDAYS[day]}</th>{row.map((count, hour) => <td key={hour}>{count}</td>)}</tr>)}</tbody></>}>
        {(width, active) => {
          const cellWidth = (width - left) / 24;
          const cell = cellHeight(width);
          const square = Math.min(cellWidth, cell) - gap;
          return (
            <>
              {rows.map((row, day) => (
                <g key={day}>
                  <text className="chart-axis" x={0} y={day * cell + cell / 2 + 3.5}>{WEEKDAYS[day].charAt(0)}</text>
                  {row.map((count, hour) => {
                    const side = count ? Math.round(square * (.4 + .6 * count / max)) : 0;
                    const [cx, cy] = [left + hour * cellWidth + cellWidth / 2, day * cell + cell / 2];
                    return (
                      <g key={hour}>
                        <rect className={`heat-cell${active === day * 24 + hour ? " is-active" : ""}`} x={left + hour * cellWidth + gap / 2} y={day * cell + gap / 2}
                          width={cellWidth - gap} height={cell - gap} rx={RADIUS}/>
                        {side ? <rect className="heat-mark" x={cx - side / 2} y={cy - side / 2} width={side} height={side} rx={RADIUS * side / square}/> : null}
                      </g>
                    );
                  })}
                </g>
              ))}
              {[0, 6, 12, 18, 23].map((hour) => <text key={hour} className="chart-axis" x={left + cellWidth * (hour + .5)} y={7 * cell + 14} textAnchor="middle">{hour} h</text>)}
            </>
          );
        }}
    </Chart>
  );
}

const DONUT = 152;
const DONUT_STROKE = 22;

function BikeTypes({ data }: { data: PeriodStats }) {
  const total = data.trips;
  const parts = [
    { key: "electrical", label: "Électrique", spoken: "en électrique", count: data.bikeTypes.electrical },
    { key: "mechanical", label: "Mécanique", spoken: "en mécanique", count: data.bikeTypes.mechanical },
    { key: "unknown", label: "Non renseigné", spoken: "sans type connu", count: data.bikeTypes.unknown }
  ].filter((part) => part.count > 0);
  const size = DONUT;
  const stroke = DONUT_STROKE;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = (count: number) => `${Math.round(count / total * 100)}${" "}%`;
  return (
    <div className="donut">
      <div className="donut-chart" style={{ width: size }}><Chart label={`Trajets ${parts.map((part) => `${part.spoken} à ${share(part.count)}`).join(", ")}`} height={size}
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
          return { x: size / 2 + Math.cos(angle) * radius, content: <><strong>{parts[index].label}</strong><span>{plural(parts[index].count, "trajet")}, soit {share(parts[index].count)}</span></> };
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

function Records({ data }: { data: PeriodStats }) {
  const { longestMinutes, busiestDayTrips, streakDays, bike } = data.records;
  const [bikeOpen, setBikeOpen] = useState(false);
  return (
    <>
    <dl className="stat-records">
      <div><dt>Plus long trajet</dt><dd>{longestMinutes != null ? hours(longestMinutes, figure) : "—"}</dd></div>
      <div><dt>Jour record</dt><dd>{busiestDayTrips ? plural(busiestDayTrips, "trajet", figure) : "—"}</dd></div>
      <div><dt>Série</dt><dd>{streakDays ? plural(streakDays, "jour", figure) : "—"}</dd></div>
      <div><dt>Vélo favori</dt><dd>{bike ? <button className="stat-bike" onClick={() => setBikeOpen(true)} aria-label={`Voir la fiche du vélo ${bike}`}>N° {bike}</button> : "—"}</dd></div>
    </dl>
    {bikeOpen && bike ? <BikeDrawer number={bike} onClose={() => setBikeOpen(false)}/> : null}
    </>
  );
}

function Ranking({ items }: { items: { name: string; count: number }[] }) {
  return (
    <ol className="stat-ranking">
      {items.map((item) => (
        <li key={item.name}>
          <span className="stat-ranking-label">{item.name}</span>
          <span className="stat-ranking-count">{formatCountSans(item.count)}<span className="sr-only"> passages</span></span>
        </li>
      ))}
    </ol>
  );
}
