/**
 * Jira 이슈 텍스트 정제 모듈 (WBS 3.2 / DFAS-152, docs/api-contract.md 2절)
 *
 * Jira의 description은 서식 정보가 담긴 ADF(Atlassian Document Format) JSON으로 옵니다.
 * 이 모듈은 그 ADF를 "뜻을 유지하며" 일반 텍스트로 바꾸고,
 * 분석·평가에 넣을 { key, summary, description } 객체를 만듭니다.
 *
 * 규칙 (DFAS-152 R1~R5)
 * - R1: 한 문단 안의 텍스트 조각은 줄바꿈 없이 이어 붙인다 (굵게·링크 때문에 문장이 쪼개지지 않게)
 * - R2: 문단과 문단 사이는 빈 줄 하나
 * - R3: 글머리 목록은 "- ", 번호 목록은 "1. ", 하위 목록은 공백 2칸 들여쓰기
 * - R4: 제목은 텍스트만 / 코드 블록은 ``` 로 감쌈 / 표는 한 행 한 줄, 칸 사이 " | "
 *       / 링크 카드는 주소 / 이미지·첨부는 "[첨부 파일]"
 * - R5: 앞뒤 공백 제거, 연속 빈 줄은 하나로 (코드 블록 안은 건드리지 않음)
 *
 * 멘션(@이름)은 기존 extractText와 같이 이름을 내보내지 않습니다.
 */

/** 문단처럼 "한 줄로 이어지는 글자 조각"을 담는 노드 종류 */
const INLINE_CONTAINERS = new Set(['paragraph', 'heading']);

/** 이미지·파일처럼 AI가 내용을 읽을 수 없는 노드 종류 (R4) */
const MEDIA_TYPES = new Set(['mediaSingle', 'mediaGroup', 'media', 'mediaInline']);

/** 코드 블록 시작·끝 표시 (R4) */
const CODE_FENCE = '```';

/** 첨부 파일 자리 표시 (R4) */
const ATTACHMENT_PLACEHOLDER = '[첨부 파일]';

/**
 * 인라인 노드(문단 안의 조각) 하나를 글자로 바꿉니다.
 *
 * @param {any} node ADF 인라인 노드
 * @returns {string}
 */
function inlineToText(node) {
  if (!node || typeof node !== 'object') return '';

  switch (node.type) {
    case 'text':
      // 굵게·기울임·링크 같은 서식(marks)은 무시하고 글자만 씁니다 (R1, R4 링크)
      return typeof node.text === 'string' ? node.text : '';

    case 'hardBreak':
      // 문단 안에서 Shift+Enter로 바꾼 줄은 그대로 줄바꿈
      return '\n';

    case 'inlineCard':
      // 주소만 있는 링크 카드는 주소를 씁니다 (R4)
      return typeof node.attrs?.url === 'string' ? node.attrs.url : '';

    case 'mention':
      // 사람 이름은 내보내지 않습니다 (기존 동작 유지)
      return '';

    default:
      if (MEDIA_TYPES.has(node.type)) return ATTACHMENT_PLACEHOLDER;

      // 모르는 인라인 노드는 안쪽 글자만 꺼냅니다
      return Array.isArray(node.content) ? node.content.map(inlineToText).join('') : '';
  }
}

/**
 * 문단·제목처럼 글자 조각을 담은 노드를 한 줄(또는 hardBreak로 나뉜 몇 줄)로 바꿉니다.
 * 조각 사이에 줄바꿈을 넣지 않는 것이 핵심입니다 (R1).
 *
 * @param {any} node
 * @returns {string}
 */
function inlineContainerToText(node) {
  const children = Array.isArray(node.content) ? node.content : [];
  return children.map(inlineToText).join('');
}

/**
 * 목록(bulletList / orderedList)을 줄 단위 텍스트로 바꿉니다 (R3).
 *
 * @param {any} node 목록 노드
 * @param {number} depth 몇 번째로 안쪽 목록인지 (0부터)
 * @returns {string}
 */
function listToText(node, depth) {
  const indent = '  '.repeat(depth);
  const items = Array.isArray(node.content) ? node.content : [];
  const start = node.type === 'orderedList' && Number.isInteger(node.attrs?.order)
    ? node.attrs.order
    : 1;

  return items
    .map((item, index) => {
      const marker = node.type === 'orderedList' ? `${start + index}. ` : '- ';
      return listItemToText(item, depth, indent + marker);
    })
    .join('\n');
}

/**
 * 목록 항목 하나를 텍스트로 바꿉니다.
 * 첫 번째 문단은 표시(- 또는 1.) 뒤에 붙이고, 안쪽 목록은 한 단계 더 들여씁니다.
 *
 * @param {any} item listItem 노드
 * @param {number} depth
 * @param {string} prefix 들여쓰기 + 표시
 * @returns {string}
 */
function listItemToText(item, depth, prefix) {
  const blocks = Array.isArray(item?.content) ? item.content : [];
  const lines = [];
  let markerUsed = false;

  for (const block of blocks) {
    if (block?.type === 'bulletList' || block?.type === 'orderedList') {
      lines.push(listToText(block, depth + 1));
      continue;
    }

    const text = blockToText(block, depth + 1);
    if (!text) continue;

    if (!markerUsed) {
      lines.push(prefix + text);
      markerUsed = true;
    } else {
      // 같은 항목 안의 두 번째 문단은 표시 없이 같은 깊이로 들여씁니다
      lines.push(' '.repeat(prefix.length) + text);
    }
  }

  if (!markerUsed) {
    // 글자 없이 안쪽 목록만 있는 항목도 표시는 남깁니다
    lines.unshift(prefix.trimEnd());
  }

  return lines.join('\n');
}

/**
 * 표를 "칸 | 칸 | 칸" 형태의 줄들로 바꿉니다 (R4).
 *
 * @param {any} node table 노드
 * @returns {string}
 */
function tableToText(node) {
  const rows = Array.isArray(node.content) ? node.content : [];

  return rows
    .map((row) => {
      const cells = Array.isArray(row?.content) ? row.content : [];
      return cells
        .map((cell) => {
          const cellBlocks = Array.isArray(cell?.content) ? cell.content : [];
          // 칸 안의 여러 문단은 한 줄로 이어 붙입니다
          return cellBlocks.map((block) => blockToText(block, 0)).filter(Boolean).join(' ');
        })
        .join(' | ');
    })
    .join('\n');
}

/**
 * 문단·목록·표 같은 블록 노드 하나를 텍스트로 바꿉니다.
 *
 * @param {any} node 블록 노드
 * @param {number} depth 목록 깊이 (목록 안에서만 쓰임)
 * @returns {string}
 */
function blockToText(node, depth = 0) {
  if (!node || typeof node !== 'object') return '';

  if (INLINE_CONTAINERS.has(node.type)) return inlineContainerToText(node);

  switch (node.type) {
    case 'bulletList':
    case 'orderedList':
      return listToText(node, depth);

    case 'codeBlock': {
      // 코드는 줄바꿈까지 그대로 두고 ``` 로 감쌉니다 (R4)
      const code = Array.isArray(node.content) ? node.content.map(inlineToText).join('') : '';
      return `${CODE_FENCE}\n${code}\n${CODE_FENCE}`;
    }

    case 'table':
      return tableToText(node);

    case 'rule':
      // 가로줄은 내용이 없으므로 건너뜁니다
      return '';

    default:
      if (MEDIA_TYPES.has(node.type)) return ATTACHMENT_PLACEHOLDER;

      // 인용(blockquote)·패널 등 안에 블록을 담은 노드는 안쪽 블록을 문단처럼 이어 씁니다
      if (Array.isArray(node.content)) return blocksToText(node.content, depth);

      return inlineToText(node);
  }
}

/**
 * 블록 여러 개를 빈 줄 하나로 구분해 이어 붙입니다 (R2).
 *
 * @param {any[]} blocks
 * @param {number} depth
 * @returns {string}
 */
function blocksToText(blocks, depth = 0) {
  return blocks
    .map((block) => blockToText(block, depth))
    .filter((text) => text.trim() !== '')
    .join('\n\n');
}

/**
 * 공백을 정리합니다 (R5).
 * - 줄 끝의 공백 제거, 연속된 빈 줄은 하나로
 * - 코드 블록(``` 사이) 안은 그대로 둡니다
 * - 마지막으로 전체 앞뒤 공백 제거
 *
 * @param {string} text
 * @returns {string}
 */
function tidyWhitespace(text) {
  const lines = text.split('\n');
  const result = [];
  let inCode = false;
  let previousBlank = false;

  for (const line of lines) {
    if (line.trim() === CODE_FENCE) {
      inCode = !inCode;
      result.push(line.trimEnd());
      previousBlank = false;
      continue;
    }

    if (inCode) {
      result.push(line);
      continue;
    }

    const trimmed = line.trimEnd();
    const isBlank = trimmed.trim() === '';

    if (isBlank && previousBlank) continue;

    result.push(isBlank ? '' : trimmed);
    previousBlank = isBlank;
  }

  return result.join('\n').trim();
}

/**
 * Jira description(ADF)을 일반 텍스트로 바꿉니다.
 * 설명이 없거나 비어 있으면 빈 문자열을 돌려줍니다 (api-contract.md 2절).
 *
 * @param {unknown} description issue.fields.description 값 (ADF 객체, 문자열 또는 null)
 * @returns {string}
 */
export function adfToPlainText(description) {
  if (description == null) return '';

  // 예전 API(v2)처럼 이미 문자열로 오는 경우
  if (typeof description === 'string') return tidyWhitespace(description);

  if (typeof description !== 'object') return '';

  const blocks = Array.isArray(description.content) ? description.content : [];
  return tidyWhitespace(blocksToText(blocks));
}

/**
 * Jira 이슈 응답을 api-contract.md 2절 형식 { key, summary, description }으로 만듭니다.
 * key나 summary가 없으면 AI를 부르기 전에 멈추도록 오류를 던집니다.
 *
 * @param {any} issue Jira REST API v3 이슈 응답
 * @returns {{ key: string, summary: string, description: string }}
 * @throws {Error} key 또는 summary가 없을 때 (안내 문장을 담은 오류, api-contract.md 6절)
 */
export function toJiraContext(issue) {
  const key = typeof issue?.key === 'string' ? issue.key.trim() : '';
  const summary = typeof issue?.fields?.summary === 'string' ? issue.fields.summary.trim() : '';

  if (!key || !summary) {
    throw new Error('Jira 이슈의 번호나 제목을 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
  }

  return {
    key,
    summary,
    description: adfToPlainText(issue.fields.description)
  };
}
