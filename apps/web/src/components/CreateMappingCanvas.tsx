import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';

import {
  ReactFlow,
  Background,
  Handle,
  Position,
  PanOnScrollMode,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type ReactFlowInstance,
  type IsValidConnection,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { CanonicalField, MappingProfilePair } from '@recon/domain';

/**
 * Canvas geometry constants — every value here was a defect found in design review, not a
 * stylistic choice. The DOM header strip above the React Flow viewport uses the same track
 * sizes so column labels never drift; zoom is locked to 1 for the same reason.
 */
export const NODE_W = 180;
export const COL_GAP = 110;
export const ROW_Y = 78;
export const CONTENT_W = NODE_W * 3 + COL_GAP * 2;

export type MappingSourceColumn = { id: string; sample: string };

const glNodeId = (name: string): string => `gl:${name}`;
const bankNodeId = (name: string): string => `bk:${name}`;
const bareColumnName = (id: string): string => id.slice(3);

type SourceSide = 'gl' | 'bank';

type SourceNodeData = Record<string, unknown> & {
  label: string;
  sample: string;
  side: SourceSide;
  mapped: boolean;
};

type DbNodeData = Record<string, unknown> & {
  label: string;
  type: string;
  note: string;
  required: boolean;
  glMapped: boolean;
  bankMapped: boolean;
};

/**
 * `@xyflow/react/dist/style.css` is an unlayered stylesheet, so its `.react-flow__handle` rules
 * always win over anything declared inside our `@layer components` CSS regardless of specificity
 * (unlayered author styles beat layered ones in the cascade). Style handles inline instead of via
 * a CSS class so the per-side color reliably applies.
 */
const handleStyle = (color: string): CSSProperties => ({ width: 10, height: 10, background: 'var(--bg-sunken)', border: `1.5px solid ${color}` });

function SourceNode({ data }: Readonly<NodeProps<Node<SourceNodeData>>>) {
  const color = data.side === 'gl' ? 'var(--accent)' : 'var(--bank)';
  return (
    <div
      className={[
        'mapping-node',
        data.side === 'gl' ? 'mapping-node--gl' : 'mapping-node--bank',
        data.mapped ? 'mapping-node--mapped' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="mapping-node__row">
        <span
          className={[
            'mapping-node__dot',
            data.mapped ? (data.side === 'gl' ? 'mapping-node__dot--gl-on' : 'mapping-node__dot--bank-on') : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
        <span className={data.mapped ? 'mapping-node__name mapping-node__name--mapped' : 'mapping-node__name'}>
          {data.label}
        </span>
      </div>
      <div className="mapping-node__sub">{data.sample ? `e.g. ${data.sample}` : 'header only'}</div>
      <Handle
        type="source"
        position={data.side === 'gl' ? Position.Right : Position.Left}
        style={handleStyle(color)}
      />
    </div>
  );
}

function DbNode({ data }: Readonly<NodeProps<Node<DbNodeData>>>) {
  const mapped = data.glMapped || data.bankMapped;
  const missingRequired = data.required && !(data.glMapped && data.bankMapped);
  return (
    <div
      className={[
        'mapping-node',
        mapped ? 'mapping-node--mapped-neutral' : '',
        missingRequired ? 'mapping-node--required-missing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Handle id="gl" type="target" position={Position.Left} style={handleStyle('var(--accent)')} />
      <Handle id="bank" type="target" position={Position.Right} style={handleStyle('var(--bank)')} />
      <div className="mapping-node__row">
        <span
          className={[
            'mapping-node__dot',
            data.glMapped ? 'mapping-node__dot--gl-on' : '',
            data.required && !data.glMapped ? 'mapping-node__dot--required' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          title="GL side"
        />
        <span className={mapped ? 'mapping-node__name mapping-node__name--mapped' : 'mapping-node__name'}>
          {data.label}
        </span>
        <span
          className={[
            'mapping-node__dot',
            data.bankMapped ? 'mapping-node__dot--bank-on' : '',
            data.required && !data.bankMapped ? 'mapping-node__dot--required' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          title="Bank side"
        />
      </div>
      <div className="mapping-node__meta">
        <span className="mapping-node__sub" style={{ paddingLeft: 0 }}>
          {data.type}
        </span>
        <span className={data.required ? 'mapping-node__pill mapping-node__pill--required' : 'mapping-node__pill'}>
          {data.required ? 'Required' : 'Optional'}
        </span>
      </div>
    </div>
  );
}

const nodeTypes = { src: SourceNode, db: DbNode };

const edgeForSide = (side: SourceSide, source: string, target: string): Edge => ({
  id: `${side}:${source}->${target}`,
  source,
  target,
  targetHandle: side,
  type: 'bezier',
  style: { stroke: side === 'gl' ? 'var(--accent)' : 'var(--bank)', strokeWidth: 1.6 },
});

/** Builds pair state (`{col, db}[]`) per side from the canvas's edge list. */
const pairsFromEdges = (edges: Edge[], side: SourceSide): MappingProfilePair[] =>
  edges
    .filter((edge) => edge.targetHandle === side)
    .map((edge) => ({ col: bareColumnName(edge.source), db: edge.target as MappingProfilePair['db'] }));

export function CreateMappingCanvas({
  glCols,
  bankCols,
  canonicalFields,
  initialGlMapping,
  initialBankMapping,
  onChange,
}: Readonly<{
  glCols: MappingSourceColumn[];
  bankCols: MappingSourceColumn[];
  canonicalFields: CanonicalField[];
  initialGlMapping?: Record<string, string>;
  initialBankMapping?: Record<string, string>;
  onChange: (mapping: { gl: MappingProfilePair[]; bank: MappingProfilePair[] }) => void;
}>) {
  const initialEdges = useMemo<Edge[]>(() => {
    const glColumnIds = new Set(glCols.map((c) => c.id));
    const bankColumnIds = new Set(bankCols.map((c) => c.id));
    const glEdges = Object.entries(initialGlMapping ?? {})
      .filter(([col]) => glColumnIds.has(col))
      .map(([col, db]) => edgeForSide('gl', glNodeId(col), db));
    const bankEdges = Object.entries(initialBankMapping ?? {})
      .filter(([col]) => bankColumnIds.has(col))
      .map(([col, db]) => edgeForSide('bank', bankNodeId(col), db));
    return [...glEdges, ...bankEdges];
    // Only re-seed from the initial mapping when the underlying column lists change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glCols, bankCols]);

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  const glMappedSources = useMemo(
    () => new Set(edges.filter((e) => e.targetHandle === 'gl').map((e) => e.source)),
    [edges],
  );
  const bankMappedSources = useMemo(
    () => new Set(edges.filter((e) => e.targetHandle === 'bank').map((e) => e.source)),
    [edges],
  );
  const glMappedTargets = useMemo(
    () => new Set(edges.filter((e) => e.targetHandle === 'gl').map((e) => e.target)),
    [edges],
  );
  const bankMappedTargets = useMemo(
    () => new Set(edges.filter((e) => e.targetHandle === 'bank').map((e) => e.target)),
    [edges],
  );

  const builtNodes = useMemo<Node[]>(
    () => [
      ...glCols.map(
        (column, index): Node<SourceNodeData> => ({
          id: glNodeId(column.id),
          type: 'src',
          position: { x: 0, y: index * ROW_Y },
          data: { label: column.id, sample: column.sample, side: 'gl', mapped: glMappedSources.has(glNodeId(column.id)) },
          draggable: false,
        }),
      ),
      ...canonicalFields.map(
        (field, index): Node<DbNodeData> => ({
          id: field.id,
          type: 'db',
          position: { x: NODE_W + COL_GAP, y: index * ROW_Y },
          data: {
            label: field.id,
            type: field.type,
            note: field.note,
            required: field.required,
            glMapped: glMappedTargets.has(field.id),
            bankMapped: bankMappedTargets.has(field.id),
          },
          draggable: false,
        }),
      ),
      ...bankCols.map(
        (column, index): Node<SourceNodeData> => ({
          id: bankNodeId(column.id),
          type: 'src',
          position: { x: (NODE_W + COL_GAP) * 2, y: index * ROW_Y },
          data: {
            label: column.id,
            sample: column.sample,
            side: 'bank',
            mapped: bankMappedSources.has(bankNodeId(column.id)),
          },
          draggable: false,
        }),
      ),
    ],
    [glCols, bankCols, canonicalFields, glMappedSources, bankMappedSources, glMappedTargets, bankMappedTargets],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(builtNodes);

  useEffect(() => {
    setNodes(builtNodes);
  }, [builtNodes, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const side: SourceSide = connection.targetHandle === 'bank' ? 'bank' : 'gl';
      setEdges((current) =>
        addEdge(
          edgeForSide(side, connection.source, connection.target),
          current.filter(
            (edge) => edge.source !== connection.source && !(edge.target === connection.target && edge.targetHandle === side),
          ),
        ),
      );
    },
    [setEdges],
  );

  // Notify the parent whenever the edge list settles after a change (delete, connect, replace).
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onChangeRef.current({ gl: pairsFromEdges(edges, 'gl'), bank: pairsFromEdges(edges, 'bank') });
  }, [edges]);

  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      const isGl = connection.source.startsWith('gl:');
      const isBank = connection.source.startsWith('bk:');
      if (!isGl && !isBank) return false;
      if (!canonicalFields.some((field) => field.id === connection.target)) return false;
      return isGl ? connection.targetHandle === 'gl' : connection.targetHandle === 'bank';
    },
    [canonicalFields],
  );

  const wrapperRef = useRef<HTMLDivElement>(null);

  // No fitView: with content taller than the canvas it centers and clips row 1.
  const onInit = useCallback((instance: ReactFlowInstance) => {
    const width = wrapperRef.current?.clientWidth ?? 0;
    void instance.setViewport({ x: Math.max(16, Math.round((width - CONTENT_W) / 2)), y: 16, zoom: 1 });
  }, []);

  const rowCount = Math.max(glCols.length, bankCols.length, canonicalFields.length);

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={onInit}
        minZoom={1}
        maxZoom={1}
        translateExtent={[
          [-240, -40],
          [CONTENT_W + 240, rowCount * ROW_Y + 40],
        ]}
        panOnDrag={false}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Vertical}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling
        nodesDraggable={false}
        deleteKeyCode={['Backspace', 'Delete']}
        connectionLineStyle={{ stroke: '#8fa3b8', strokeWidth: 2, strokeDasharray: '5 4' }}
        isValidConnection={isValidConnection}
        className="mapping-canvas-flow"
      >
        <Background color="rgba(240, 246, 252, 0.06)" gap={24} size={1} />
      </ReactFlow>
    </div>
  );
}
