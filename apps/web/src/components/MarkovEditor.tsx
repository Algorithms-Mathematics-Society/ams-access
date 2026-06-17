"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────
export interface MarkovState {
  id: string;
  x: number;
  y: number;
  isInitial: boolean;
  isAccepting: boolean;
}

export interface MarkovTransition {
  id: string;
  from: string;
  to: string;
  probability: string;
}

export interface MarkovChain {
  states: MarkovState[];
  transitions: MarkovTransition[];
}

const RADIUS = 28;
const CANVAS_W = 780;
const CANVAS_H = 440;

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function edgePoints(states: MarkovState[], transitions: MarkovTransition[], t: MarkovTransition) {
  const src = states.find((s) => s.id === t.from)!;
  const dst = states.find((s) => s.id === t.to)!;
  if (!src || !dst) return { x1: 0, y1: 0, x2: 0, y2: 0, cx: 0, cy: 0 };
  const hasReverse = transitions.some((o) => o.from === t.to && o.to === t.from);
  const dx = dst.x - src.x;
  const dy = dst.y - src.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const px = -ny;
  const py = nx;
  const offset = hasReverse ? 18 : 0;
  const x1 = src.x + nx * RADIUS + px * offset;
  const y1 = src.y + ny * RADIUS + py * offset;
  const x2 = dst.x - nx * RADIUS + px * offset;
  const y2 = dst.y - ny * RADIUS + py * offset;
  const cx = (x1 + x2) / 2 + px * 20;
  const cy = (y1 + y2) / 2 + py * 20;
  return { x1, y1, x2, y2, cx, cy };
}

function selfLoopPath(cx: number, cy: number) {
  const r = RADIUS;
  const lx = cx - r * 0.8;
  const ly = cy - r;
  const rx = cx + r * 0.8;
  const ry = cy - r;
  return `M ${lx} ${ly} C ${lx} ${cy - r * 2.8} ${rx} ${cy - r * 2.8} ${rx} ${ry}`;
}

function selfLoopMid(cx: number, cy: number) {
  return { x: cx, y: cy - RADIUS * 2.4 };
}

/** Returns a copy of the chain with x/y stripped from states (for storage/display). */
export function normalizeChain(chain: MarkovChain): {
  states: Omit<MarkovState, "x" | "y">[];
  transitions: MarkovTransition[];
} {
  return {
    states: chain.states.map(({ id, isInitial, isAccepting }) => ({ id, isInitial, isAccepting })),
    transitions: chain.transitions,
  };
}

function parseProb(s: string): number {
  s = s.trim();
  const slash = s.indexOf("/");
  if (slash >= 0) {
    const n = parseFloat(s.slice(0, slash));
    const d = parseFloat(s.slice(slash + 1));
    return d !== 0 ? n / d : 0;
  }
  return parseFloat(s) || 0;
}

// ─── Component ────────────────────────────────────────────────
interface Props {
  value: MarkovChain;
  onChange: (c: MarkovChain) => void;
  readOnly?: boolean;
}

export default function MarkovEditor({ value, onChange, readOnly = false }: Props) {
  const [mode, setMode] = useState<"select" | "transition">("select");
  const [drawFrom, setDrawFrom] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ type: "state" | "transition"; id: string } | null>(
    null
  );
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [editingProb, setEditingProb] = useState<{ id: string; val: string } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nextIdx = useRef(0);

  useEffect(() => {
    const maxN = value.states.reduce((m, s) => {
      const n = parseInt(s.id.replace(/\D/g, ""), 10);
      return isNaN(n) ? m : Math.max(m, n + 1);
    }, 0);
    nextIdx.current = maxN;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function svgCoords(e: React.MouseEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }

  function handleSvgDoubleClick(e: React.MouseEvent) {
    if (readOnly || mode !== "select") return;
    if ((e.target as Element).tagName !== "rect") return;
    const { x, y } = svgCoords(e);
    const id = `q${nextIdx.current++}`;
    onChange({
      ...value,
      states: [
        ...value.states,
        { id, x, y, isInitial: value.states.length === 0, isAccepting: false },
      ],
    });
    setSelected({ type: "state", id });
  }

  function handleStateMouseDown(e: React.MouseEvent, stateId: string) {
    e.stopPropagation();
    if (readOnly) return;
    if (mode === "transition") {
      if (!drawFrom) {
        setDrawFrom(stateId);
      } else {
        if (!value.transitions.find((t) => t.from === drawFrom && t.to === stateId)) {
          onChange({
            ...value,
            transitions: [
              ...value.transitions,
              { id: uid(), from: drawFrom, to: stateId, probability: "0" },
            ],
          });
        }
        setDrawFrom(null);
        setMode("select");
      }
      return;
    }
    setSelected({ type: "state", id: stateId });
    const s = value.states.find((st) => st.id === stateId)!;
    const { x, y } = svgCoords(e);
    setDragging({ id: stateId, ox: x - s.x, oy: y - s.y });
  }

  function handleSvgMouseMove(e: React.MouseEvent) {
    const pos = svgCoords(e);
    setMousePos(pos);
    if (!dragging || readOnly) return;
    onChange({
      ...value,
      states: value.states.map((s) =>
        s.id === dragging.id
          ? {
              ...s,
              x: Math.max(RADIUS, Math.min(CANVAS_W - RADIUS, pos.x - dragging.ox)),
              y: Math.max(RADIUS, Math.min(CANVAS_H - RADIUS, pos.y - dragging.oy)),
            }
          : s
      ),
    });
  }

  function handleSvgMouseUp() {
    setDragging(null);
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (readOnly || !selected) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (selected.type === "state") {
        onChange({
          states: value.states.filter((s) => s.id !== selected.id),
          transitions: value.transitions.filter(
            (t) => t.from !== selected.id && t.to !== selected.id
          ),
        });
      } else {
        onChange({ ...value, transitions: value.transitions.filter((t) => t.id !== selected.id) });
      }
      setSelected(null);
    },
    [readOnly, selected, value, onChange]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  function handleStateContextMenu(e: React.MouseEvent, stateId: string) {
    e.preventDefault();
    if (readOnly) return;
    onChange({
      ...value,
      states: value.states.map((s) => {
        if (s.id !== stateId) return s;
        if (!s.isInitial && !s.isAccepting) return { ...s, isInitial: true };
        if (s.isInitial && !s.isAccepting) return { ...s, isAccepting: true };
        if (s.isInitial && s.isAccepting) return { ...s, isInitial: false };
        return { ...s, isAccepting: false };
      }),
    });
  }

  function commitProb(transId: string, val: string) {
    onChange({
      ...value,
      transitions: value.transitions.map((t) =>
        t.id === transId ? { ...t, probability: val.trim() || "0" } : t
      ),
    });
    setEditingProb(null);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrawFrom(null);
        setMode("select");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Validation errors
  const validationErrors: string[] = [];
  for (const s of value.states) {
    const outs = value.transitions.filter((t) => t.from === s.id);
    if (outs.length === 0) continue;
    const sum = outs.reduce((acc, t) => acc + parseProb(t.probability), 0);
    if (Math.abs(sum - 1) > 0.001)
      validationErrors.push(`${s.id}: probs sum ${sum.toFixed(3)} ≠ 1.0`);
  }
  const initials = value.states.filter((s) => s.isInitial);
  if (initials.length === 0 && value.states.length > 0) validationErrors.push("No initial state");
  if (initials.length > 1) validationErrors.push("Multiple initial states");

  return (
    <div>
      {!readOnly && (
        <div
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {(["select", "transition"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setDrawFrom(null);
              }}
              style={{
                padding: "4px 10px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                border:
                  mode === m
                    ? "1px solid rgb(var(--accent-rgb) / 0.6)"
                    : "1px solid rgba(100,116,139,0.35)",
                background: mode === m ? "rgb(var(--accent-rgb) / 0.12)" : "rgba(255,255,255,0.03)",
                color: mode === m ? "var(--color-accent-light)" : "#94a3b8",
              }}
            >
              {m === "select" ? "↖ Select" : "→ Draw Arrow"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const id = `q${nextIdx.current++}`;
              onChange({
                ...value,
                states: [
                  ...value.states,
                  {
                    id,
                    x: 80 + (value.states.length % 5) * 150,
                    y: 80 + Math.floor(value.states.length / 5) * 130,
                    isInitial: value.states.length === 0,
                    isAccepting: false,
                  },
                ],
              });
            }}
            style={{
              padding: "4px 10px",
              borderRadius: 7,
              fontSize: 11,
              fontWeight: 500,
              cursor: "pointer",
              border: "1px solid rgba(100,116,139,0.35)",
              background: "rgba(255,255,255,0.03)",
              color: "#94a3b8",
            }}
          >
            + State
          </button>
          {selected && (
            <button
              type="button"
              onClick={() => {
                if (selected.type === "state")
                  onChange({
                    states: value.states.filter((s) => s.id !== selected.id),
                    transitions: value.transitions.filter(
                      (t) => t.from !== selected.id && t.to !== selected.id
                    ),
                  });
                else
                  onChange({
                    ...value,
                    transitions: value.transitions.filter((t) => t.id !== selected.id),
                  });
                setSelected(null);
              }}
              style={{
                padding: "4px 10px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                border: "1px solid rgba(239,68,68,0.5)",
                background: "transparent",
                color: "#f87171",
              }}
            >
              ✕ Delete
            </button>
          )}
          <span style={{ fontSize: 10, color: "#64748b", marginLeft: 4 }}>
            {mode === "transition"
              ? drawFrom
                ? "Click target (Esc cancel)"
                : "Click source"
              : "Dbl-click canvas = new state · Right-click = toggle start/accept"}
          </span>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        style={{
          width: "100%",
          height: CANVAS_H,
          background: "#060b18",
          borderRadius: 10,
          border: "1px solid rgb(var(--accent-rgb) / 0.15)",
          cursor: dragging ? "grabbing" : mode === "transition" ? "crosshair" : "default",
          display: "block",
        }}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onDoubleClick={handleSvgDoubleClick}
        onClick={() => {
          if (mode === "select") setSelected(null);
        }}
      >
        <defs>
          <marker id="mk-arr" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0,10 3.5,0 7" fill="var(--color-accent-base)" />
          </marker>
          <marker id="mk-sel" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0,10 3.5,0 7" fill="var(--color-accent-light)" />
          </marker>
        </defs>
        <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="transparent" />

        {drawFrom &&
          mousePos &&
          (() => {
            const src = value.states.find((s) => s.id === drawFrom);
            if (!src) return null;
            return (
              <line
                x1={src.x}
                y1={src.y}
                x2={mousePos.x}
                y2={mousePos.y}
                stroke="rgb(var(--accent-rgb) / 0.333)"
                strokeWidth={2}
                strokeDasharray="5 3"
              />
            );
          })()}

        {value.transitions.map((t) => {
          const isSel = selected?.type === "transition" && selected.id === t.id;
          const stroke = isSel ? "var(--color-accent-light)" : "var(--color-accent-base)";
          const mrkr = `url(#${isSel ? "mk-sel" : "mk-arr"})`;
          const editing = editingProb?.id === t.id;

          if (t.from === t.to) {
            const src = value.states.find((s) => s.id === t.from);
            if (!src) return null;
            const mid = selfLoopMid(src.x, src.y);
            return (
              <g
                key={t.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected({ type: "transition", id: t.id });
                }}
              >
                <path
                  d={selfLoopPath(src.x, src.y)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isSel ? 2.4 : 1.8}
                  markerEnd={mrkr}
                  style={{ cursor: "pointer" }}
                />
                <ProbLabel
                  x={mid.x}
                  y={mid.y}
                  transId={t.id}
                  value={t.probability}
                  editing={editing}
                  editVal={editingProb?.val ?? ""}
                  onStartEdit={(e) => {
                    e.stopPropagation();
                    if (!readOnly) setEditingProb({ id: t.id, val: t.probability });
                  }}
                  onCommit={(v) => commitProb(t.id, v)}
                  onEditChange={(v) => setEditingProb((ep) => (ep ? { ...ep, val: v } : null))}
                />
              </g>
            );
          }

          const pts = edgePoints(value.states, value.transitions, t);
          const mlx = 0.25 * pts.x1 + 0.5 * pts.cx + 0.25 * pts.x2;
          const mly = 0.25 * pts.y1 + 0.5 * pts.cy + 0.25 * pts.y2;
          return (
            <g
              key={t.id}
              onClick={(e) => {
                e.stopPropagation();
                setSelected({ type: "transition", id: t.id });
              }}
            >
              <path
                d={`M ${pts.x1} ${pts.y1} Q ${pts.cx} ${pts.cy} ${pts.x2} ${pts.y2}`}
                fill="none"
                stroke={stroke}
                strokeWidth={isSel ? 2.4 : 1.8}
                markerEnd={mrkr}
                style={{ cursor: "pointer" }}
              />
              <ProbLabel
                x={mlx}
                y={mly}
                transId={t.id}
                value={t.probability}
                editing={editing}
                editVal={editingProb?.val ?? ""}
                onStartEdit={(e) => {
                  e.stopPropagation();
                  if (!readOnly) setEditingProb({ id: t.id, val: t.probability });
                }}
                onCommit={(v) => commitProb(t.id, v)}
                onEditChange={(v) => setEditingProb((ep) => (ep ? { ...ep, val: v } : null))}
              />
            </g>
          );
        })}

        {value.states.map((s) => {
          const isSel = selected?.type === "state" && selected.id === s.id;
          const isDrawSrc = drawFrom === s.id;
          return (
            <g
              key={s.id}
              onMouseDown={(e) => handleStateMouseDown(e, s.id)}
              onContextMenu={(e) => handleStateContextMenu(e, s.id)}
              style={{ cursor: dragging?.id === s.id ? "grabbing" : readOnly ? "default" : "grab" }}
            >
              {s.isAccepting && (
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={RADIUS + 5}
                  fill="none"
                  stroke={isSel ? "var(--color-accent-light)" : "rgb(var(--accent-rgb) / 0.4)"}
                  strokeWidth={1.5}
                />
              )}
              <circle
                cx={s.x}
                cy={s.y}
                r={RADIUS}
                fill={
                  isSel
                    ? "rgb(var(--accent-rgb) / 0.22)"
                    : isDrawSrc
                      ? "rgb(var(--accent-rgb) / 0.32)"
                      : "rgb(var(--accent-rgb) / 0.1)"
                }
                stroke={
                  isSel || isDrawSrc ? "var(--color-accent-light)" : "var(--color-accent-base)"
                }
                strokeWidth={isSel ? 2.4 : 1.8}
              />
              {s.isInitial && (
                <line
                  x1={s.x - RADIUS - 22}
                  y1={s.y}
                  x2={s.x - RADIUS - 2}
                  y2={s.y}
                  stroke="var(--color-accent-base)"
                  strokeWidth={2}
                  markerEnd="url(#mk-arr)"
                />
              )}
              <text
                x={s.x}
                y={s.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={13}
                fontWeight={600}
                fill={isSel ? "var(--color-accent-light)" : "#e2d9f3"}
                style={{ userSelect: "none", pointerEvents: "none" }}
              >
                {s.id}
              </text>
              {(s.isInitial || s.isAccepting) && (
                <text
                  x={s.x}
                  y={s.y + RADIUS + 14}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#64748b"
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  {s.isInitial && s.isAccepting ? "start·accept" : s.isInitial ? "start" : "accept"}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {validationErrors.length > 0 && (
        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
          {validationErrors.map((e, i) => (
            <li key={i} style={{ fontSize: 11, color: "#f87171", display: "flex", gap: 4 }}>
              ⚠ {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProbLabel({
  x,
  y,
  transId,
  value,
  editing,
  editVal,
  onStartEdit,
  onCommit,
  onEditChange,
}: {
  x: number;
  y: number;
  transId: string;
  value: string;
  editing: boolean;
  editVal: string;
  onStartEdit: (e: React.MouseEvent) => void;
  onCommit: (v: string) => void;
  onEditChange: (v: string) => void;
}) {
  void transId;
  if (editing) {
    return (
      <foreignObject x={x - 28} y={y - 12} width={56} height={24}>
        <input
          // @ts-expect-error xmlns
          xmlns="http://www.w3.org/1999/xhtml"
          autoFocus
          value={editVal}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={() => onCommit(editVal)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit(editVal);
            if (e.key === "Escape") onCommit(value);
          }}
          style={{
            width: "100%",
            height: "100%",
            background: "#1e1b4b",
            border: "1px solid var(--color-accent-base)",
            borderRadius: 4,
            color: "var(--color-accent-light)",
            fontSize: 11,
            textAlign: "center",
            padding: "0 2px",
          }}
        />
      </foreignObject>
    );
  }
  return (
    <g onClick={onStartEdit} style={{ cursor: "text" }}>
      <rect
        x={x - 20}
        y={y - 10}
        width={40}
        height={20}
        rx={4}
        fill="#0d1323"
        stroke="rgb(var(--accent-rgb) / 0.2)"
        strokeWidth={1}
      />
      <text
        x={x}
        y={y + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={11}
        fill="var(--color-accent-light)"
        style={{ userSelect: "none" }}
      >
        {value}
      </text>
    </g>
  );
}
