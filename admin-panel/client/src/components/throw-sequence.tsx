import { useMemo } from "react";
import { Kbd } from "./ui/kbd";
import { describeLineupThrow, throwTimeline } from "../../../shared/throw-motion";

const STEP_TITLES = ["Lineup", "Bewegung", "Abwurf"];
const seconds = (value: number) => `${value > 0.005 ? "+" : value < -0.005 ? "−" : ""}${(Math.abs(value) < 0.005 ? 0 : Math.abs(value)).toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;

// Steps and held keys come from the recorded trace; lineups without one show nothing here.
export function ThrowSequence({ nade }) {
  const description = useMemo(() => describeLineupThrow(nade),
    [nade.throwTrace, nade.is_jumpthrow, nade.is_crouch, nade.is_walking, nade.is_running, nade.is_stepping, nade.click_type]);
  const motion = description?.motion;
  const timeline = useMemo(() => motion && (motion.movement || motion.jump || motion.setup.crouch !== motion.release.crouch)
    ? throwTimeline(nade.throwTrace, motion) : null, [motion, nade.throwTrace]);
  if (!description) return null;
  const steps = [description.lineup, description.movement, description.release];
  return <div className="throw-sequence">
    <ol className="throw-steps">{steps.map((step, index) => <li key={STEP_TITLES[index]}>
      <span className="throw-step-index" aria-hidden="true">{index + 1}</span>
      <div><span className="throw-step-title">{STEP_TITLES[index]}</span><p>{step}</p></div>
    </li>)}</ol>
    {description.notes.map(note => <p key={note} className="throw-sequence-note">{note}</p>)}
    {timeline && <KeyTimeline timeline={timeline} />}
  </div>;
}

function KeyTimeline({ timeline }: { timeline: NonNullable<ReturnType<typeof throwTimeline>> }) {
  const span = Math.max(timeline.to - timeline.from, 0.01);
  const at = (time: number) => `${((time - timeline.from) / span) * 100}%`;
  const markers = [
    ...(timeline.start !== null ? [{ time: timeline.start, label: "Losgehen", className: "start" }] : []),
    { time: 0, label: "Loslassen", className: "release" },
  ];
  return <figure className="key-timeline" aria-label="Gedrückte Tasten bis zum Abwurf">
    <figcaption>Tastenfolge</figcaption>
    <div className="key-timeline-grid">
      {timeline.lanes.map(lane => <div key={lane.key} className="key-timeline-lane">
        <Kbd>{lane.key}</Kbd>
        <div className="key-timeline-track">
          {lane.spans.map(([from, to]) => <span key={from} style={{ left: at(from), width: `max(2px, calc(${at(to)} - ${at(from)}))` }} title={`${lane.key}: ${seconds(from)} bis ${seconds(to)}`} />)}
          {markers.map(marker => <i key={marker.className} className={marker.className} style={{ left: at(marker.time) }} aria-hidden="true" />)}
        </div>
      </div>)}
      <div className="key-timeline-axis" aria-hidden="true"><span />
        <div>{markers.map(marker => <span key={marker.className} className={marker.className} style={{ left: at(marker.time) }}>{marker.label}{marker.className === "start" ? ` ${seconds(marker.time)}` : ""}</span>)}</div>
      </div>
    </div>
  </figure>;
}
