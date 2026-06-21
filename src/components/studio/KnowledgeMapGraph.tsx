'use client';

import { useMemo } from 'react';
import type { KnowledgeMapData, KnowledgeMapEdgeConfidence, KnowledgeMapNodeType } from '@/lib/knowledge-map-types';

interface KnowledgeMapGraphProps {
  map: KnowledgeMapData;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

type PositionedNode = KnowledgeMapData['nodes'][number] & {
  x: number;
  y: number;
  radius: number;
  labelVisible: boolean;
};

type PositionedEdge = KnowledgeMapData['edges'][number] & {
  path: string;
  labelX: number;
  labelY: number;
  labelVisible: boolean;
};

const TYPE_COLOR: Record<KnowledgeMapNodeType, { fill: string; border: string; glow: string }> = {
  concept: { fill: '#60a5fa', border: '#bfdbfe', glow: 'rgba(96,165,250,0.3)' },
  method: { fill: '#34d399', border: '#bbf7d0', glow: 'rgba(52,211,153,0.24)' },
  finding: { fill: '#f59e0b', border: '#fde68a', glow: 'rgba(245,158,11,0.24)' },
  question: { fill: '#a78bfa', border: '#ddd6fe', glow: 'rgba(167,139,250,0.25)' },
  source: { fill: '#94a3b8', border: '#e2e8f0', glow: 'rgba(148,163,184,0.22)' },
  term: { fill: '#22d3ee', border: '#cffafe', glow: 'rgba(34,211,238,0.25)' },
};

const CONFIDENCE_STYLE: Record<KnowledgeMapEdgeConfidence, { color: string; width: number; dash?: string }> = {
  EXTRACTED: { color: '#93c5fd', width: 2.4 },
  INFERRED: { color: '#a7f3d0', width: 1.8, dash: '7 7' },
  AMBIGUOUS: { color: '#fbbf24', width: 1.5, dash: '4 7' },
};

const CONFIDENCE_LABEL: Record<KnowledgeMapEdgeConfidence, string> = {
  EXTRACTED: '资料明示',
  INFERRED: '推断关系',
  AMBIGUOUS: '待复核',
};

const WIDTH = 1000;
const HEIGHT = 620;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

function truncateLabel(label: string, max = 12) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function titleForNode(node: KnowledgeMapData['nodes'][number]) {
  const citations = node.citationNumbers.length ? `引用: ${node.citationNumbers.map(n => `[${n}]`).join(' ')}` : '引用: 待补充';
  return `${node.label}\n${node.summary}\n${citations}`;
}

function titleForEdge(edge: KnowledgeMapData['edges'][number]) {
  const citations = edge.citationNumbers.length ? `引用: ${edge.citationNumbers.map(n => `[${n}]`).join(' ')}` : '引用: 待补充';
  return `${edge.relation}\n${edge.evidence}\n${CONFIDENCE_LABEL[edge.confidence] || '推断关系'}\n${citations}`;
}

function edgePath(source: PositionedNode, target: PositionedNode) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const startX = source.x + (dx / distance) * (source.radius + 5);
  const startY = source.y + (dy / distance) * (source.radius + 5);
  const endX = target.x - (dx / distance) * (target.radius + 8);
  const endY = target.y - (dy / distance) * (target.radius + 8);
  const bend = Math.min(54, distance * 0.1);
  const normalX = (-dy / distance) * bend;
  const normalY = (dx / distance) * bend;
  const midX = (startX + endX) / 2 + normalX;
  const midY = (startY + endY) / 2 + normalY;

  return {
    path: `M ${startX.toFixed(1)} ${startY.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`,
    labelX: midX,
    labelY: midY,
  };
}

function layoutGraph(map: KnowledgeMapData) {
  const focal = map.nodes.find(node => node.focal) || map.nodes[0];
  if (!focal) return { nodes: [] as PositionedNode[], edges: [] as PositionedEdge[] };

  const connectedToFocal = new Set<string>();
  map.edges.forEach(edge => {
    if (edge.source === focal.id) connectedToFocal.add(edge.target);
    if (edge.target === focal.id) connectedToFocal.add(edge.source);
  });

  const ringNodes = map.nodes
    .filter(node => node.id !== focal.id)
    .toSorted((a, b) => {
      const aDirect = connectedToFocal.has(a.id) ? 1 : 0;
      const bDirect = connectedToFocal.has(b.id) ? 1 : 0;
      return bDirect - aDirect || b.degree - a.degree || a.label.localeCompare(b.label);
    });

  const positioned = new Map<string, PositionedNode>();
  positioned.set(focal.id, {
    ...focal,
    x: CENTER_X,
    y: CENTER_Y,
    radius: 48,
    labelVisible: true,
  });

  ringNodes.forEach((node, index) => {
    const count = Math.max(1, ringNodes.length);
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    const direct = connectedToFocal.has(node.id);
    const radius = direct ? 210 : 270;
    const stagger = direct ? (index % 2) * 22 : (index % 2) * 30;
    const x = CENTER_X + Math.cos(angle) * (radius + stagger);
    const y = CENTER_Y + Math.sin(angle) * (radius + stagger * 0.6);
    positioned.set(node.id, {
      ...node,
      x,
      y,
      radius: Math.min(32, 19 + node.degree * 3),
      labelVisible: direct || node.degree >= 2 || index < 8,
    });
  });

  const nodes = Array.from(positioned.values());
  const edges = map.edges.flatMap(edge => {
    const source = positioned.get(edge.source);
    const target = positioned.get(edge.target);
    if (!source || !target) return [];
    const path = edgePath(source, target);
    return [{
      ...edge,
      ...path,
      labelVisible: edge.source === focal.id || edge.target === focal.id || edge.confidence === 'EXTRACTED',
    }];
  });

  return { nodes, edges };
}

export function KnowledgeMapGraph({ map, selectedNodeId, onSelectNode }: KnowledgeMapGraphProps) {
  const { nodes, edges } = useMemo(() => layoutGraph(map), [map]);
  const selectedId = selectedNodeId || nodes.find(node => node.focal)?.id || nodes[0]?.id || null;

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#07111f]" data-testid="knowledge-map-graph">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(14,165,233,0.2),transparent_26%),radial-gradient(circle_at_18%_78%,rgba(168,85,247,0.14),transparent_24%)]" />
      <svg className="relative h-full w-full" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="资料关系网络">
        <defs>
          <filter id="knowledge-map-soft-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="12" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id="knowledge-map-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="#cbd5e1" opacity="0.82" />
          </marker>
        </defs>

        {edges.map(edge => {
          const style = CONFIDENCE_STYLE[edge.confidence] || CONFIDENCE_STYLE.INFERRED;
          return (
            <g key={edge.id} data-testid="knowledge-map-edge">
              <path
                d={edge.path}
                fill="none"
                stroke={style.color}
                strokeWidth={style.width}
                strokeLinecap="round"
                strokeDasharray={style.dash}
                markerEnd="url(#knowledge-map-arrow)"
                opacity={edge.confidence === 'AMBIGUOUS' ? 0.52 : 0.8}
              >
                <title>{titleForEdge(edge)}</title>
              </path>
              {edge.labelVisible && (
                <text
                  x={edge.labelX}
                  y={edge.labelY}
                  textAnchor="middle"
                  className="pointer-events-none fill-slate-200 text-[13px] font-semibold"
                  paintOrder="stroke"
                  stroke="rgba(7,17,31,0.84)"
                  strokeWidth="5"
                >
                  {truncateLabel(edge.relation, 7)}
                </text>
              )}
            </g>
          );
        })}

        {nodes.map(node => {
          const color = TYPE_COLOR[node.type] || TYPE_COLOR.concept;
          const selected = node.id === selectedId;
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`查看${node.label}`}
              onClick={() => onSelectNode(node.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelectNode(node.id);
              }}
              className="cursor-pointer outline-none"
              data-testid={node.focal ? 'knowledge-map-focal-node' : 'knowledge-map-node'}
            >
              <title>{titleForNode(node)}</title>
              <circle cx={node.x} cy={node.y} r={node.radius + 16} fill={color.glow} opacity={selected ? 0.95 : 0.58} filter="url(#knowledge-map-soft-glow)" />
              <circle cx={node.x} cy={node.y} r={node.radius} fill={color.fill} stroke={node.focal || selected ? '#ffffff' : color.border} strokeWidth={node.focal ? 4 : selected ? 3 : 1.6} />
              <circle cx={node.x - node.radius * 0.32} cy={node.y - node.radius * 0.34} r={Math.max(4, node.radius * 0.18)} fill="rgba(255,255,255,0.68)" />
              {node.labelVisible && (
                <text
                  x={node.x}
                  y={node.y + node.radius + (node.focal ? 30 : 24)}
                  textAnchor="middle"
                  className="pointer-events-none fill-slate-100 text-[18px] font-semibold"
                  paintOrder="stroke"
                  stroke="rgba(7,17,31,0.82)"
                  strokeWidth="6"
                >
                  {truncateLabel(node.label, node.focal ? 16 : 10)}
                </text>
              )}
              {node.focal && (
                <text
                  x={node.x}
                  y={node.y - node.radius - 20}
                  textAnchor="middle"
                  className="pointer-events-none fill-cyan-100 text-[14px] font-semibold"
                  paintOrder="stroke"
                  stroke="rgba(7,17,31,0.82)"
                  strokeWidth="5"
                >
                  当前核心词
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute left-5 top-5 rounded-full border border-white/10 bg-slate-950/50 px-3 py-1.5 text-xs text-slate-200 backdrop-blur-xl">
        点击节点查看相邻关系
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-2">
        {Object.entries(CONFIDENCE_STYLE).map(([key, style]) => (
          <span key={key} className="rounded-full border border-white/10 bg-slate-950/55 px-2.5 py-1 text-[10px] text-slate-200 backdrop-blur-xl">
            <span className="mr-1 inline-block h-1.5 w-5 rounded-full align-middle" style={{ background: style.color, opacity: style.dash ? 0.55 : 0.9 }} />
            {CONFIDENCE_LABEL[key as KnowledgeMapEdgeConfidence] || '推断关系'}
          </span>
        ))}
      </div>
    </div>
  );
}
