import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const document = require('../contracts/report-layout-profiles.v1.json') as LayoutDocument;

export type LayoutBlockKind = 'table' | 'bar' | 'line' | 'donut' | 'scatter' | 'matrix' | 'timeline' | 'pele';
export type LayoutSection = { id: string; blocks: LayoutBlockKind[] };
export type ReportPresentation = { family: string; narrative_boundary: string; sections: LayoutSection[] };
type LayoutDocument = { contract_version: string; layout_basis: string; reports: Record<string, ReportPresentation> };

export function getReportPresentation(reportId: string): ReportPresentation | undefined {
  const presentation = document.reports[reportId];
  if (!presentation) return undefined;
  return { ...presentation, sections: presentation.sections.map(section => ({ ...section, blocks: [...section.blocks] })) };
}

export function renderMissingBlockText(kind: LayoutBlockKind): string {
  const labels: Record<LayoutBlockKind, string> = {
    table: '원천 필드가 연결된 표',
    bar: '동일 단위의 범주형 비교 차트',
    line: '시점이 정렬된 시계열 차트',
    donut: '합계와 분류가 확인된 구성비 차트',
    scatter: '동일 대상군의 두 지표 비교 차트',
    matrix: '축·범위가 정의된 비교 행렬',
    timeline: '발생·공개 시각이 구분된 사건 타임라인',
    pele: '근거가 연결된 관계·전달 경로 도식',
  };
  return `${labels[kind]} 입력이 아직 없거나 검증되지 않았습니다. 값과 관계를 추정해 채우지 않았습니다.`;
}
