import {
  renderLatestDevelopment
} from './latest-development.js?v=latest-1';
import {
  downloadReportPdf
} from './pdf-download.js?v=direct-pdf-1';

const SVG_NS = 'http://www.w3.org/2000/svg';

const asArray = value =>
  Array.isArray(value) ? value : [];

const asText = value =>
  typeof value === 'string' ? value : '';

const ROLE_NAMES = {
  concept: 'General concept',
  driver: 'Driver',
  goal: 'Goal',
  constraint: 'Constraint',
  direction: 'Option',
  outcome: 'Outcome'
};

const LINE_COLORS = [
  '#287b78',
  '#b1742c',
  '#317349',
  '#65559a',
  '#a54c66',
  '#316c9b',
  '#766225',
  '#874e28'
];

function validWeight(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function formatWeight(value) {
  return validWeight(value)
    ? value.toFixed(2)
    : 'Unavailable';
}

function conceptLetter(index) {
  let value = index + 1;
  let result = '';

  while (value > 0) {
    value--;

    result =
      String.fromCharCode(65 + value % 26) +
      result;

    value = Math.floor(value / 26);
  }

  return result;
}

function conceptName(node) {
  return (
    `${conceptLetter(node.layoutIndex)} — ` +
    `${node.label || node.id}`
  );
}

function roleName(role) {
  return ROLE_NAMES[role] || 'Unclassified';
}

function formatDate(value) {
  if (!value) return 'Not recorded';

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? 'Not recorded'
    : date.toLocaleString();
}

function element(doc, tag, value, parent) {
  const node = doc.createElement(tag);

  if (value != null) {
    node.textContent = String(value);
  }

  if (parent) parent.append(node);

  return node;
}

function svgElement(doc, tag, attributes, parent) {
  const node = doc.createElementNS(SVG_NS, tag);

  for (const [key, value] of Object.entries(
    attributes || {}
  )) {
    node.setAttribute(key, String(value));
  }

  if (parent) parent.append(node);

  return node;
}

function section(doc, parent, title) {
  const node = element(doc, 'section', null, parent);

  element(doc, 'h2', title, node);

  return node;
}

function paragraph(doc, parent, value, className) {
  const node = element(doc, 'p', value, parent);

  if (className) node.className = className;

  return node;
}

function bulletList(doc, parent, values, emptyText) {
  if (!values.length) {
    paragraph(
      doc,
      parent,
      emptyText || 'Not identified in this saved report.'
    );

    return;
  }

  const list = element(doc, 'ul', null, parent);

  for (const value of values) {
    element(doc, 'li', value, list);
  }
}

function addTable(doc, parent, headers, rows) {
  const table = element(doc, 'table', null, parent);
  const head = element(
    doc,
    'tr',
    null,
    element(doc, 'thead', null, table)
  );

  for (const header of headers) {
    element(doc, 'th', header, head).scope = 'col';
  }

  const body = element(doc, 'tbody', null, table);

  for (const values of rows) {
    const row = element(doc, 'tr', null, body);

    for (const value of values) {
      element(
        doc,
        'td',
        value == null ? 'Not recorded' : value,
        row
      );
    }
  }

  if (!rows.length) {
    const row = element(doc, 'tr', null, body);
    const cell = element(
      doc,
      'td',
      'No records saved.',
      row
    );

    cell.colSpan = headers.length;
  }

  return table;
}

function addSvgImage(doc, parent, markup, description) {
  const image = element(doc, 'img', null, parent);

  image.className = 'report-figure';
  image.alt = description;

  image.src =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(markup);

  return image;
}

function waitForImage(image) {
  return new Promise((resolve, reject) => {
    if (image.complete) {
      if (image.naturalWidth) {
        resolve();
      } else {
        reject(new Error('A report image could not load.'));
      }

      return;
    }

    image.onload = resolve;

    image.onerror = () => {
      reject(new Error('A report image could not load.'));
    };
  });
}

function buildEvolutionFigure(frames, doc) {
  const concepts = new Map();

  frames.forEach((frame, frameIndex) => {
    for (const node of asArray(frame.nodes)) {
      if (!concepts.has(node.id)) {
        concepts.set(node.id, {
          ...node,
          values: Array(frames.length).fill(null)
        });
      }

      const saved = concepts.get(node.id);

      saved.label = node.label;

      saved.values[frameIndex] = validWeight(node.weight)
        ? node.weight
        : null;
    }
  });

  const series = [...concepts.values()].sort(
    (a, b) => a.layoutIndex - b.layoutIndex
  );

  const width = 1100;
  const height = 460;

  const left = 85;
  const right = 45;
  const top = 30;
  const bottom = 65;

  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const drawing = svgElement(doc, 'svg', {
    xmlns: SVG_NS,
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    'font-family': 'system-ui, sans-serif'
  });

  svgElement(doc, 'rect', {
    width,
    height,
    fill: '#ffffff'
  }, drawing);

  const weights = series.flatMap(concept =>
    concept.values.filter(value => value != null)
  );

  const maximum = weights.length
    ? Math.max(...weights)
    : 0;

  const ceiling = Math.min(
    1,
    Math.max(0.1, Math.ceil(maximum * 10) / 10)
  );

  const xPosition = index =>
    left + (
      frames.length > 1
        ? index / (frames.length - 1) * plotWidth
        : plotWidth / 2
    );

  const yPosition = value =>
    top + (1 - value / ceiling) * plotHeight;

  for (let tick = 0; tick <= 4; tick++) {
    const value = ceiling * tick / 4;
    const y = yPosition(value);

    svgElement(doc, 'line', {
      x1: left,
      y1: y,
      x2: width - right,
      y2: y,
      stroke: '#dbe6dd'
    }, drawing);

    svgElement(doc, 'text', {
      x: left - 12,
      y: y + 4,
      'text-anchor': 'end',
      'font-size': 13,
      fill: '#000000'
    }, drawing).textContent = value.toFixed(2);
  }

  const labelStep = Math.max(
    1,
    Math.ceil(frames.length / 12)
  );

  frames.forEach((frame, index) => {
    if (
      index % labelStep !== 0 &&
      index !== frames.length - 1
    ) {
      return;
    }

    svgElement(doc, 'text', {
      x: xPosition(index),
      y: height - 38,
      'text-anchor': 'middle',
      'font-size': 13,
      fill: '#000000'
    }, drawing).textContent =
      String(frame.sequence ?? index + 1);
  });

  svgElement(doc, 'text', {
    x: left + plotWidth / 2,
    y: height - 10,
    'text-anchor': 'middle',
    'font-size': 14,
    fill: '#000000'
  }, drawing).textContent = 'Conversation exchange';

  svgElement(doc, 'text', {
    transform:
      `translate(22 ${top + plotHeight / 2}) rotate(-90)`,
    'text-anchor': 'middle',
    'font-size': 14,
    fill: '#000000'
  }, drawing).textContent =
    'Relative discussion prominence';

  for (const concept of series) {
    const color = LINE_COLORS[
      concept.layoutIndex % LINE_COLORS.length
    ];

    const dash = ['', '7 4', '2 4'][
      Math.floor(
        concept.layoutIndex / LINE_COLORS.length
      ) % 3
    ];

    let path = '';
    let connected = false;

    concept.values.forEach((value, index) => {
      if (value == null) {
        connected = false;
        return;
      }

      path +=
        `${connected ? 'L' : 'M'}` +
        `${xPosition(index)} ${yPosition(value)} `;

      connected = true;
    });

    if (!path) continue;

    svgElement(doc, 'path', {
      d: path,
      fill: 'none',
      stroke: color,
      'stroke-width': 1.8,
      'stroke-dasharray': dash
    }, drawing);

    concept.values.forEach((value, index) => {
      if (value == null) return;

      svgElement(doc, 'circle', {
        cx: xPosition(index),
        cy: yPosition(value),
        r: 3,
        fill: color
      }, drawing);
    });
  }

  if (!weights.length) {
    svgElement(doc, 'text', {
      x: width / 2,
      y: height / 2,
      'text-anchor': 'middle',
      'font-size': 16,
      fill: '#526459'
    }, drawing).textContent =
      'No saved prominence values.';
  }

  return {
    markup: new XMLSerializer().serializeToString(
      drawing
    ),
    series
  };
}

function renderConversationInsights(doc, parent, row) {
  const target = section(
    doc,
    parent,
    'Conversation insights'
  );

  paragraph(
    doc,
    target,
    'AI-proposed interpretations, not verified business ' +
    'facts. Assistant suggestions are not user decisions.',
    'report-note'
  );

  const snapshots = asArray(
    row.conversation_insights?.snapshots
  );

  const model = snapshots.at(-1)?.model;

  if (!model) {
    paragraph(doc, target, 'No saved insights model.');
    return;
  }

  const latestDevelopment = element(
    doc,
    'div',
    null,
    target
  );

  renderLatestDevelopment(row, latestDevelopment);

  element(doc, 'h3', 'Your situation', target);

  bulletList(
    doc,
    target,
    asArray(model.concepts)
      .filter(concept =>
        concept.role === 'concept' &&
        asArray(concept.evidence).some(
          evidence => evidence.speaker === 'user'
        )
      )
      .map(concept => concept.definition)
  );

  const groups = [
    ['Goals and limits', ['goal', 'constraint']],
    ['Factors discussed', ['concept', 'driver', 'outcome']],
    ['Directions and options', ['direction']]
  ];

  for (const [title, roles] of groups) {
    element(doc, 'h3', title, target);

    const concepts = asArray(model.concepts).filter(
      concept => roles.includes(concept.role)
    );

    if (!concepts.length) {
      paragraph(doc, target, 'Not yet identified.');
    }

    for (const concept of concepts) {
      element(
        doc,
        'h4',
        concept.label || concept.id,
        target
      );

      paragraph(
        doc,
        target,
        asText(concept.definition) ||
          'No definition saved.'
      );

      const speakers = new Set(
        asArray(concept.evidence).map(
          evidence => evidence.speaker
        )
      );

      paragraph(
        doc,
        target,
        speakers.size === 2
          ? 'Discussed by you and the assistant'
          : speakers.has('user')
            ? 'Mentioned by you'
            : 'Introduced by the assistant',
        'report-note'
      );

      if (concept.state_estimate) {
        const estimate = concept.state_estimate;

        paragraph(
          doc,
          target,
          `Recorded user estimate: ` +
          `${Math.round(estimate.probability * 100)}% — ` +
          `${estimate.proposition}. Check the source ` +
          `before relying on this interpretation.`
        );
      }

      for (const evidence of asArray(concept.evidence)) {
        paragraph(
          doc,
          target,
          `${evidence.speaker === 'user' ? 'You' : 'Assistant'}` +
          ` · ${evidence.turn_id ?? 'turn unavailable'}`,
          'report-note'
        );

        element(
          doc,
          'blockquote',
          asText(evidence.quote) ||
            'Quotation unavailable',
          target
        );
      }

      paragraph(
        doc,
        target,
        `Extraction score: ` +
        `${concept.extraction_confidence ?? 'Not recorded'}. ` +
        `Uncalibrated, not a business probability. ` +
        `Status: ${concept.review_status || 'Not recorded'}.`,
        'report-note'
      );
    }
  }

  const names = new Map(
    asArray(model.concepts).map(
      concept => [concept.id, concept.label]
    )
  );

  element(
    doc,
    'h3',
    'Possible connections — not established causes',
    target
  );

  bulletList(
    doc,
    target,
    asArray(model.relationships).map(relationship =>
      `${names.get(relationship.from_id) || relationship.from_id}` +
      ` ${relationship.directed === true ? '→' : '—'} ` +
      `${names.get(relationship.to_id) || relationship.to_id}: ` +
      `${relationship.description || relationship.type || 'No description saved.'}`
    )
  );

  element(
    doc,
    'h3',
    'How the discussion developed',
    target
  );

  for (const [index, snapshot] of snapshots.entries()) {
    element(
      doc,
      'h4',
      `Exchange ${snapshot.sequence ?? index + 1} · ` +
      formatDate(snapshot.created_at),
      target
    );

    bulletList(
      doc,
      target,
      asArray(snapshot.model?.changes)
        .filter(change => change.kind !== 'unchanged')
        .map(change => change.description),
      'No substantive changes identified.'
    );
  }

  element(doc, 'h3', 'Questions still open', target);

  bulletList(
    doc,
    target,
    asArray(model.open_questions)
  );
}

export function createTopicPdfWindow() {
  const reportWindow = window.open('', '_blank');

  if (!reportWindow) {
    throw new Error(
      'The report window was blocked. Allow popups ' +
      'for this site, then retry.'
    );
  }

  const doc = reportWindow.document;

  doc.open();

  doc.write(
    '<!doctype html><html lang="en"><head>' +
    '<meta charset="utf-8">' +
    '<title>Preparing topic PDF</title>' +
    '</head><body>' +
    '<p>Preparing your topic report… ' +
    'Close this window to cancel.</p>' +
    '</body></html>'
  );

  doc.close();

  return reportWindow;
}

export function showTopicPdfError(reportWindow, message) {
  if (!reportWindow || reportWindow.closed) return;

  const doc = reportWindow.document;

  doc.body.replaceChildren();

  element(
    doc,
    'h1',
    'Could not prepare this report',
    doc.body
  );

  paragraph(doc, doc.body, message);
}

export async function fillTopicPdfWindow({
  win,
  row,
  frames,
  networkSvg,
  assertCurrent
}) {
  assertCurrent();

  if (win.closed) {
    throw new Error('The report window was closed.');
  }

  const doc = win.document;
  const finalFrame = frames.at(-1);

  if (!finalFrame) {
    throw new Error('No saved network frames are available.');
  }

  doc.body.replaceChildren();

  doc.title =
    (row.source_state?.title || 'Topic') +
    ' — Forenture report';

  const style = element(doc, 'style', null, doc.head);

  style.textContent = `
    @page {
      size: A4;
      margin: 17mm 15mm;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: #ffffff;
      color: #111111;
      font: 11pt/1.5 system-ui, sans-serif;
    }

    main {
      max-width: 1000px;
      margin: 20px auto;
      padding: 24px;
    }

    h1 { font-size: 24pt; line-height: 1.2; }

    h2 {
      font-size: 18pt;
      border-bottom: 1px solid #b9cebf;
      padding-bottom: 5px;
      margin-top: 25px;
    }

    h3 { font-size: 13pt; margin-top: 18px; }
    h4 { font-size: 11pt; margin-bottom: 5px; }

    h1, h2, h3, h4 { break-after: avoid; }

    p {
      margin: 7px 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    li { overflow-wrap: anywhere; }

    blockquote {
      margin: 8px 0;
      padding: 8px 12px;
      border-left: 3px solid #80b491;
      background: #f7faf8;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .report-note {
      color: #526459;
      font-size: 9pt;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 8.5pt;
      margin: 10px 0;
    }

    th, td {
      border: 1px solid #dbe6dd;
      padding: 6px;
      vertical-align: top;
      text-align: left;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    thead { display: table-header-group; }
    tr { break-inside: avoid; }

    .report-figure {
      display: block;
      width: 100%;
      height: auto;
      max-height: 235mm;
      object-fit: contain;
      background: #ffffff;
      margin: 12px 0;
      break-inside: avoid;
    }

    .report-legend {
      columns: 2;
      column-gap: 20px;
      font-size: 9pt;
    }

    .report-legend p { break-inside: avoid; }

    .report-swatch {
      display: inline-block;
      width: 18px;
      border-top: 3px solid;
      margin-right: 7px;
      vertical-align: middle;
    }

    .report-page {
      break-before: page;
    }

    .report-controls {
      position: sticky;
      top: 0;
      background: #ffffff;
      border-bottom: 1px solid #b9cebf;
      padding: 12px 20px;
      z-index: 5;
      font: 14px system-ui, sans-serif;
    }

    .report-controls button {
      padding: 8px 14px;
      margin-right: 12px;
      cursor: pointer;
    }

    .report-warning {
      border: 1px solid #b9cebf;
      background: #f5f9f6;
      padding: 12px;
    }

    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    @media print {
      main {
        max-width: none;
        margin: 0;
        padding: 0;
      }

      body { font-size: 10pt; }

      .report-controls {
        display: none !important;
      }

      blockquote {
        max-height: none !important;
        overflow: visible !important;
      }
    }
  `;

  const controls = element(
    doc,
    'div',
    null,
    doc.body
  );

  controls.className = 'report-controls';

  const printButton = element(
    doc,
    'button',
    'Print / Save as PDF',
    controls
  );

  printButton.type = 'button';
  printButton.disabled = true;
  printButton.onclick = () => win.print();

  element(
    doc,
    'span',
    'Choose “Save as PDF” in the print dialog.',
    controls
  );

  const main = element(doc, 'main', null, doc.body);

  element(
    doc,
    'h1',
    row.source_state?.title || 'Untitled conversation',
    main
  );

  paragraph(
    doc,
    main,
    'Forenture · Latest completed topic report'
  );

  addTable(
    doc,
    main,
    ['Report information', 'Value'],
    [
      ['Prepared', new Date().toLocaleString()],
      ['Report requested', formatDate(row.requested_at)],
      ['Report completed', formatDate(row.generation_completed_at)],
      ['Snapshot ID', row.id],
      ['Revision', row.revision],
      ['Latest exchange', finalFrame.sequence],
      ['Boundary turn ID', row.last_turn_id]
    ]
  );

  paragraph(
    doc,
    main,
    'This report uses one saved report pair matching the ' +
    'latest completed conversation checked during export. ' +
    'Insights, roles, relationships, and prominence estimates ' +
    'are AI-proposed interpretations. Moving graph nodes ' +
    'changes readability, not the underlying model.',
    'report-warning'
  );

  renderConversationInsights(doc, main, row);

  const networkSection = section(
    doc,
    main,
    'Latest concepts network'
  );

  networkSection.className = 'report-page';

  paragraph(
    doc,
    networkSection,
    `Exchange ${finalFrame.sequence}. The complete graph ` +
    'is fitted to the page while preserving node positions.',
    'report-note'
  );

  const images = [
    addSvgImage(
      doc,
      networkSection,
      networkSvg,
      'Latest concept network with the captured arrangement'
    )
  ];

  paragraph(
    doc,
    networkSection,
    'Letters identify concepts. Circle size represents ' +
    'discussion prominence. Green shade indicates first ' +
    'appearance. Line thickness represents expressed ' +
    'connection strength. Arrows show recorded direction, ' +
    'not proven causation.',
    'report-note'
  );

  element(
    doc,
    'h3',
    'Graph explanation',
    networkSection
  );

  paragraph(
    doc,
    networkSection,
    `The graph contains ${finalFrame.nodes.length} concepts ` +
    `and ${finalFrame.edges.length} recorded connections.`
  );

  const prominent = finalFrame.nodes
    .filter(node => validWeight(node.weight))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  paragraph(
    doc,
    networkSection,
    prominent.length
      ? 'The largest saved discussion shares are ' +
        prominent.map(node =>
          `${conceptName(node)} (${formatWeight(node.weight)})`
        ).join(', ') +
        '. These shares are not business probabilities.'
      : 'No valid prominence weights were saved.'
  );

  paragraph(
    doc,
    networkSection,
    'Connections describe model-proposed associations. ' +
    'An option is not necessarily an adopted decision, ' +
    'and an outcome is not necessarily an achieved result.'
  );

  const roleCounts = new Map();

  for (const node of finalFrame.nodes) {
    const role = roleName(node.role);

    roleCounts.set(
      role,
      (roleCounts.get(role) || 0) + 1
    );
  }

  addTable(
    doc,
    networkSection,
    ['Role', 'Number of nodes'],
    [...roleCounts]
  );

  element(
    doc,
    'h3',
    'Each concept and its role',
    networkSection
  );

  for (const node of finalFrame.nodes) {
    element(
      doc,
      'h4',
      `${conceptName(node)} · ${roleName(node.role)}`,
      networkSection
    );

    paragraph(
      doc,
      networkSection,
      asText(node.definition) || 'No definition saved.'
    );

    if (asText(node.weight_reason)) {
      paragraph(
        doc,
        networkSection,
        'Prominence explanation: ' + node.weight_reason
      );
    }
  }

  const conceptSection = section(
    doc,
    main,
    'Concept table — latest exchange'
  );

  addTable(
    doc,
    conceptSection,
    [
      'Node / concept',
      'Role',
      'Definition',
      'Prominence',
      'Weight explanation'
    ],
    finalFrame.nodes.map(node => [
      conceptName(node),
      roleName(node.role),
      asText(node.definition) || 'Not recorded',
      formatWeight(node.weight),
      asText(node.weight_reason) || 'Not recorded'
    ])
  );

  const connections = section(
    doc,
    main,
    'Connections and their interpretation'
  );

  const names = new Map(
    finalFrame.nodes.map(node => [
      node.id,
      conceptName(node)
    ])
  );

  const connectionName = edge =>
    `${names.get(edge.from_id) || edge.from_id}` +
    ` ${edge.directed === true ? '→' : '—'} ` +
    `${names.get(edge.to_id) || edge.to_id}`;

  if (!finalFrame.edges.length) {
    paragraph(
      doc,
      connections,
      'No connections were saved in the latest exchange.'
    );
  }

  finalFrame.edges.forEach((edge, index) => {
    element(
      doc,
      'h4',
      `${index + 1}. ${connectionName(edge)}`,
      connections
    );

    paragraph(
      doc,
      connections,
      asText(edge.description) ||
        asText(edge.type) ||
        'No relationship description saved.'
    );

    if (asText(edge.weight_reason)) {
      paragraph(
        doc,
        connections,
        'Connection-strength explanation: ' +
          edge.weight_reason
      );
    }
  });

  addTable(
    doc,
    connections,
    ['Connection', 'Type / direction', 'Description', 'Strength'],
    finalFrame.edges.map(edge => [
      connectionName(edge),
      `${edge.type || 'Unspecified'}\n` +
      `${edge.directed === true ? 'Directed' : 'Undirected'}`,
      asText(edge.description) || 'Not recorded',
      formatWeight(edge.weight)
    ])
  );

  const evolution = section(
    doc,
    main,
    'Discussion evolution'
  );

  evolution.className = 'report-page';

  paragraph(
    doc,
    evolution,
    'The export includes all saved concepts, not just the ' +
    'lines selected on screen. Missing concepts or weights ' +
    'are gaps, not zeroes. A lower share can reflect more ' +
    'attention to other concepts rather than rejection.',
    'report-note'
  );

  const figure = buildEvolutionFigure(frames, doc);

  images.push(
    addSvgImage(
      doc,
      evolution,
      figure.markup,
      'Concept prominence across saved exchanges'
    )
  );

  const legend = element(
    doc,
    'div',
    null,
    evolution
  );

  legend.className = 'report-legend';

  for (const concept of figure.series) {
    const rowElement = paragraph(doc, legend, null);

    const swatch = element(
      doc,
      'span',
      null,
      rowElement
    );

    swatch.className = 'report-swatch';

    swatch.style.borderColor = LINE_COLORS[
      concept.layoutIndex % LINE_COLORS.length
    ];

    rowElement.append(
      doc.createTextNode(conceptName(concept))
    );
  }

  element(
    doc,
    'h3',
    'How each concept develops',
    evolution
  );

  for (const concept of figure.series) {
    element(
      doc,
      'h4',
      conceptName(concept),
      evolution
    );

    let previous = null;

    for (const frame of frames) {
      const node = frame.nodes.find(
        item => item.id === concept.id
      );

      if (!node) {
        if (previous) {
          paragraph(
            doc,
            evolution,
            `Exchange ${frame.sequence}: not recorded. ` +
            'This does not by itself establish rejection.'
          );
        }

        continue;
      }

      const changes = asArray(frame.changes).filter(
        change =>
          change.concept_id === node.id &&
          change.kind !== 'unchanged'
      );

      let description;

      if (changes.length) {
        description = changes.map(change =>
          `${change.kind || 'Change'}: ` +
          `${change.description || 'No description saved.'}`
        ).join(' ');
      } else if (!previous) {
        description =
          asText(node.definition) || 'No definition saved.';
      } else if (previous.definition !== node.definition) {
        description =
          'Definition revised: ' +
          (asText(node.definition) || 'Not recorded');
      } else {
        description =
          'No substantive change description was saved.';
      }

      const roleChange =
        previous && previous.role !== node.role
          ? ` Role changed from ${roleName(previous.role)} ` +
            `to ${roleName(node.role)}.`
          : '';

      paragraph(
        doc,
        evolution,
        `Exchange ${frame.sequence}: ${roleName(node.role)}; ` +
        `prominence ${formatWeight(node.weight)}.` +
        roleChange + ' ' + description
      );

      previous = node;
    }
  }

  const values = section(
    doc,
    main,
    'Evolution values and roles'
  );

  addTable(
    doc,
    values,
    ['Exchange', 'Concept', 'Role', 'Prominence'],
    frames.flatMap(frame =>
      frame.nodes.map(node => [
        String(frame.sequence),
        conceptName(node),
        roleName(node.role),
        formatWeight(node.weight)
      ])
    )
  );

  const source = section(
    doc,
    main,
    'Captured conversation — source appendix'
  );

  paragraph(
    doc,
    source,
    'These are the saved user prompts and assistant ' +
    'responses used by this report. Source Markdown ' +
    'is preserved as text.',
    'report-note'
  );

  asArray(row.source_state?.turns).forEach(
    (turn, index) => {
      element(
        doc,
        'h3',
        `Exchange ${index + 1}`,
        source
      );

      element(doc, 'h4', 'User', source);
      paragraph(doc, source, asText(turn.prompt));

      element(doc, 'h4', 'Assistant', source);
      paragraph(doc, source, asText(turn.response));
    }
  );

  main.querySelectorAll('details').forEach(node => {
    node.open = true;
  });

  main.querySelectorAll(
    'button,input,select,textarea,script,iframe'
  ).forEach(node => node.remove());

  await Promise.all(images.map(waitForImage));

  if (doc.fonts?.ready) {
    await doc.fonts.ready;
  }

  assertCurrent();

  if (win.closed) {
    throw new Error('The report window was closed.');
  }

  printButton.disabled = false;
  win.focus();

  win.setTimeout(() => {
    if (win.closed) return;

    try {
      assertCurrent();
      win.print();
    } catch (error) {
      showTopicPdfError(win, error.message);
    }
  }, 100);
}
