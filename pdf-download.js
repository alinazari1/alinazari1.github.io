function inlineMarkdown(value) {
  const source = String(value ?? '');
  const result = [];

  const pattern =
    /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*([^*\n]+)\*)/g;

  let previous = 0;
  let match;

  while ((match = pattern.exec(source))) {
    if (match.index > previous) {
      result.push({
        text: source.slice(previous, match.index)
      });
    }

    if (match[2] != null || match[3] != null) {
      result.push({
        text: match[2] ?? match[3],
        bold: true
      });
    } else if (match[4] != null) {
      result.push({
        text: match[4],
        background: '#f1f4f2'
      });
    } else if (match[5] != null) {
      const item = {
        text: match[5],
        color: '#285b40',
        decoration: 'underline'
      };

      const target = match[6].trim();

      if (/^(https?:|mailto:)/i.test(target)) {
        item.link = target;
      }

      result.push(item);
    } else {
      result.push({
        text: match[7],
        italics: true
      });
    }

    previous = pattern.lastIndex;
  }

  if (previous < source.length) {
    result.push({
      text: source.slice(previous)
    });
  }

  return result.length ? result : [{ text: '' }];
}

function markdownBlocks(value) {
  const lines = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  const output = [];

  let index = 0;

  const bulletPattern = /^\s*[-+*]\s+(.+)$/;
  const orderedPattern = /^\s*\d+[.)]\s+(.+)$/;
  const headingPattern = /^\s{0,3}(#{1,6})\s+(.+)$/;

  const isTableSeparator = line =>
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(
      line
    );

  const tableCells = line =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cell => cell.trim());

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index++;
      continue;
    }

    if (/^\s*```/.test(line)) {
      index++;

      const code = [];

      while (
        index < lines.length &&
        !/^\s*```/.test(lines[index])
      ) {
        code.push(lines[index]);
        index++;
      }

      if (index < lines.length) index++;

      output.push({
        text: code.join('\n'),
        fontSize: 9,
        background: '#f5f7f5',
        margin: [0, 4, 0, 8]
      });

      continue;
    }

    const heading = line.match(headingPattern);

    if (heading) {
      const level = Math.min(heading[1].length, 4);

      output.push({
        text: inlineMarkdown(
          heading[2].replace(/\s+#+\s*$/, '')
        ),
        style: `heading${level}`,
        headlineLevel: level
      });

      index++;
      continue;
    }

    if (
      index + 1 < lines.length &&
      line.includes('|') &&
      isTableSeparator(lines[index + 1])
    ) {
      const headers = tableCells(line);
      const rows = [headers];

      index += 2;

      while (
        index < lines.length &&
        lines[index].trim() &&
        lines[index].includes('|')
      ) {
        rows.push(tableCells(lines[index]));
        index++;
      }

      const columnCount = Math.max(
        ...rows.map(row => row.length)
      );

      output.push({
        table: {
          headerRows: 1,
          widths: Array(columnCount).fill('*'),

          body: rows.map((row, rowIndex) =>
            Array.from(
              { length: columnCount },
              (_, column) => ({
                text: inlineMarkdown(row[column] || ''),
                bold: rowIndex === 0,
                fillColor:
                  rowIndex === 0 ? '#edf4ef' : undefined,
                margin: [2, 3, 2, 3]
              })
            )
          )
        },

        fontSize: 8.5,
        layout: 'lightHorizontalLines',
        margin: [0, 5, 0, 10]
      });

      continue;
    }

    const bullet = line.match(bulletPattern);
    const ordered = line.match(orderedPattern);

    if (bullet || ordered) {
      const pattern = bullet
        ? bulletPattern
        : orderedPattern;

      const items = [];

      while (index < lines.length) {
        const item = lines[index].match(pattern);

        if (!item) break;

        items.push({
          text: inlineMarkdown(item[1])
        });

        index++;
      }

      output.push({
        [bullet ? 'ul' : 'ol']: items,
        margin: [0, 3, 0, 8]
      });

      continue;
    }

    if (/^\s*>\s+/.test(line)) {
      const quote = [];

      while (
        index < lines.length &&
        /^\s*>\s+/.test(lines[index])
      ) {
        quote.push(
          lines[index].replace(/^\s*>\s?/, '')
        );

        index++;
      }

      output.push({
        text: inlineMarkdown(quote.join('\n')),
        color: '#455b4d',
        margin: [12, 4, 0, 8]
      });

      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      index++;
      continue;
    }

    const paragraph = [line];

    index++;

    while (index < lines.length) {
      const next = lines[index];

      if (
        !next.trim() ||
        headingPattern.test(next) ||
        bulletPattern.test(next) ||
        orderedPattern.test(next) ||
        /^\s*```/.test(next) ||
        /^\s*>\s+/.test(next) ||
        (
          index + 1 < lines.length &&
          next.includes('|') &&
          isTableSeparator(lines[index + 1])
        )
      ) {
        break;
      }

      paragraph.push(next);
      index++;
    }

    output.push({
      text: inlineMarkdown(paragraph.join('\n')),
      margin: [0, 0, 0, 8]
    });
  }

  return output;
}

function inlineDom(node) {
  if (node.nodeType === 3) {
    return [{ text: node.nodeValue || '' }];
  }

  if (node.nodeType !== 1) return [];

  const tag = node.tagName.toLowerCase();

  if (tag === 'br') {
    return [{ text: '\n' }];
  }

  if (node.classList.contains('report-swatch')) {
    const color = node.style.borderColor || '#315a40';

    return [{
      text: '— ',
      color: normalizeColor(color)
    }];
  }

  const children = [...node.childNodes]
    .flatMap(inlineDom);

  if (tag === 'strong' || tag === 'b') {
    return children.map(item => ({
      ...item,
      bold: true
    }));
  }

  if (tag === 'em' || tag === 'i') {
    return children.map(item => ({
      ...item,
      italics: true
    }));
  }

  return children;
}

function normalizeColor(value) {
  if (value.startsWith('#')) return value;

  const parts = value.match(
    /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/
  );

  if (!parts) return '#315a40';

  return '#' + parts.slice(1, 4)
    .map(part =>
      Number(part).toString(16).padStart(2, '0')
    )
    .join('');
}

async function imageAsPng(image) {
  if (!image.complete || !image.naturalWidth) {
    await new Promise((resolve, reject) => {
      image.onload = resolve;

      image.onerror = () => {
        reject(new Error('A PDF figure could not load.'));
      };
    });
  }

  const originalWidth = image.naturalWidth || 1100;
  const originalHeight = image.naturalHeight || 600;

  const scale = Math.min(
    2,
    4096 / Math.max(originalWidth, originalHeight)
  );

  const canvas = document.createElement('canvas');

  canvas.width = Math.max(
    1,
    Math.round(originalWidth * scale)
  );

  canvas.height = Math.max(
    1,
    Math.round(originalHeight * scale)
  );

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('PDF image rendering is unavailable.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas.toDataURL('image/png');
}

async function convertElement(node, figureSize) {
  if (node.nodeType === 3) {
    const value = (node.nodeValue || '').trim();

    return value ? markdownBlocks(value) : [];
  }

  if (node.nodeType !== 1) return [];

  const tag = node.tagName.toLowerCase();

  if (
    ['script', 'style', 'button', 'input', 'select', 'iframe']
      .includes(tag)
  ) {
    return [];
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Math.min(Number(tag[1]), 4);

    return [{
      text: inlineMarkdown(node.textContent),
      style: `heading${level}`,
      headlineLevel: level
    }];
  }

  if (tag === 'img') {
    return [{
      image: await imageAsPng(node),
      fit: figureSize,
      alignment: 'center',
      margin: [0, 8, 0, 12]
    }];
  }

  if (tag === 'table') {
    const rows = [...node.rows];
    const columnCount = Math.max(
      1,
      ...rows.map(row => row.cells.length)
    );

    const headerRows = node.tHead
      ? node.tHead.rows.length
      : 0;

    return [{
      table: {
        headerRows,
        widths: Array(columnCount).fill('*'),

        body: rows.map((row, rowIndex) =>
          Array.from(
            { length: columnCount },
            (_, column) => {
              const cell = row.cells[column];

              return {
                text: inlineMarkdown(
                  cell?.textContent || ''
                ),

                bold: rowIndex < headerRows,

                fillColor:
                  rowIndex < headerRows
                    ? '#edf4ef'
                    : undefined,

                margin: [2, 3, 2, 3]
              };
            }
          )
        )
      },

      fontSize: 8.5,
      layout: 'lightHorizontalLines',
      margin: [0, 5, 0, 12]
    }];
  }

  if (tag === 'ul' || tag === 'ol') {
    const items = [...node.children]
      .filter(child =>
        child.tagName.toLowerCase() === 'li'
      )
      .map(child => ({
        text: inlineMarkdown(child.textContent)
      }));

    return [{
      [tag]: items,
      margin: [0, 3, 0, 8]
    }];
  }

  if (tag === 'blockquote') {
    return [{
      stack: markdownBlocks(node.textContent),
      color: '#455b4d',
      margin: [12, 4, 0, 8]
    }];
  }

  if (tag === 'p') {
    if (node.querySelector('.report-swatch')) {
      return [{
        text: inlineDom(node),
        fontSize: 9,
        margin: [0, 0, 0, 4]
      }];
    }

    const blocks = markdownBlocks(node.textContent);

    if (node.classList.contains('report-note')) {
      for (const block of blocks) {
        block.fontSize = 9;
        block.color = '#526459';
      }
    }

    return blocks;
  }

  const content = [];

  for (const child of node.childNodes) {
    content.push(
      ...await convertElement(child, figureSize)
    );
  }

  if (
    node.classList.contains('report-page') &&
    content.length
  ) {
    content[0].pageBreak = 'before';
  }

  return content;
}

export async function downloadReportPdf(
  doc,
  {
    title,
    filename,
    assertCurrent,
    pageMargins = [40, 40, 40, 40]
  }
) {
  if (!window.pdfMake?.createPdf) {
    throw new Error(
      'The PDF library did not load. Check the PDFMake ' +
      'script tags in ai-chat.html.'
    );
  }

  assertCurrent();

  const main = doc.querySelector('main');

  if (!main) {
    throw new Error('The report content was not found.');
  }

  const pageWidth = 595.28;
  const pageHeight = 841.89;

  const figureSize = [
    pageWidth - pageMargins[0] - pageMargins[2],
    pageHeight - pageMargins[1] - pageMargins[3] - 25
  ];

  const content = [];

  for (const node of main.childNodes) {
    content.push(
      ...await convertElement(node, figureSize)
    );
  }

  assertCurrent();

  const definition = {
    pageSize: 'A4',
    pageMargins,

    info: {
      title,
      author: 'Forenture',
      subject: 'Conversation insights and concept network'
    },

    defaultStyle: {
      font: 'Roboto',
      fontSize: 10,
      lineHeight: 1.2,
      color: '#111111'
    },

    styles: {
      heading1: {
        fontSize: 23,
        bold: true,
        margin: [0, 0, 0, 14]
      },

      heading2: {
        fontSize: 17,
        bold: true,
        margin: [0, 15, 0, 8]
      },

      heading3: {
        fontSize: 13,
        bold: true,
        margin: [0, 12, 0, 6]
      },

      heading4: {
        fontSize: 11,
        bold: true,
        margin: [0, 9, 0, 5]
      }
    },

    content
  };

  const blob = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(
        'PDF generation took too long. Please retry.'
      ));
    }, 120000);

    try {
      window.pdfMake.createPdf(definition).getBlob(
        result => {
          clearTimeout(timeout);
          resolve(result);
        }
      );
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });

  assertCurrent();

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.style.display = 'none';

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10000);
}
