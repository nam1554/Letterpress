import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentProvider } from "./types";

// 4×4 blue PNG — stands in for hosted eDM images.
const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGNkYPjPwMDAwMDAxAAADQEBAZftEkcAAAAASUVORK5CYII=",
  "base64",
);

function sampleHtml(figmaUrl: string, responsive: boolean): string {
  const media = responsive
    ? `<style>@media (max-width:480px){.container{width:100%!important}.pad{padding:16px!important}}</style>`
    : "";
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sample eDM (mock)</title>
${media}
</head>
<body style="margin:0;background:#f4f6f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" class="container" width="700" cellpadding="0" cellspacing="0" style="width:700px;background:#ffffff;">
  <tr><td class="pad" style="padding:32px;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
    <img src="images/logo.png" width="150" height="27" alt="logo" style="display:block;">
    <h1 style="margin:24px 0 8px;font-size:28px;color:#111;">Mock eDM 산출물</h1>
    <p style="margin:0;font-size:15px;color:#444;line-height:1.6;">
      이 파일은 <b>MockProvider</b>가 생성한 샘플입니다.<br>
      원본 Figma: <a href="${figmaUrl}" style="color:#2563eb;">${figmaUrl}</a>
    </p>
  </td></tr>
  <tr><td style="padding:0 32px 32px;font-family:sans-serif;">
    <a href="https://intro.aisurfer.com/" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;">자세히 보기</a>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>
`;
}

const STEPS = [
  "Figma 프레임 가져오는 중 (get_screenshot / get_design_context)",
  "에셋 다운로드 및 최적화",
  "Pretendard 서브셋 폰트 생성",
  "이메일 안전 테이블 HTML 빌드",
  "픽셀 검증 (compare.py) — RESULT: PASS",
  "반응형 변형 생성 및 패키징",
];

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });

export const mockProvider: AgentProvider = {
  id: "mock",
  label: "Mock (샘플 산출물, 토큰 소모 없음)",

  async run(task, onEvent, signal) {
    const outDir = path.join(task.workDir, "output");
    const imgDir = path.join(outDir, "images");
    await mkdir(imgDir, { recursive: true });

    for (const step of STEPS) {
      onEvent({ ts: Date.now(), type: "status", text: step });
      await delay(400, signal);
    }

    await writeFile(path.join(outDir, "edm_figma.html"), sampleHtml(task.figmaUrl, false));
    await writeFile(path.join(outDir, "edm_responsive.html"), sampleHtml(task.figmaUrl, true));
    await writeFile(path.join(imgDir, "logo.png"), SAMPLE_PNG);
    // 실제 파이프라인이 작업 루트에 남기는 검증 이미지도 흉내낸다 (리포트 UI 확인용).
    for (const name of ["side_by_side.png", "diff_heat.png", "figma_full.png", "my_full.png"]) {
      await writeFile(path.join(task.workDir, name), SAMPLE_PNG);
    }

    onEvent({ ts: Date.now(), type: "status", text: "output/ 에 산출물 3개 기록 완료" });
    return {
      ok: true,
      summary:
        "샘플 eDM 생성 완료: edm_figma.html, edm_responsive.html, images/logo.png (mock)",
    };
  },
};
