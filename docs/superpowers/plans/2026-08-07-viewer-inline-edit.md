# 뷰어 인라인 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 읽기 전용 뷰어(`/jobs/[id]/view`)에 텍스트 + 간단 스타일(글자색·크기·굵기·배경색) WYSIWYG 편집과 저장/원본 복원을 붙인다.

**Architecture:** same-origin iframe 문서에 `contentEditable`을 켜서 본문을 직접 타이핑하고, 요소 선택 시 부모 페이지에 뜨는 미니 패널이 선택 요소의 인라인 스타일을 수정한다. 저장은 신규 `PUT /api/jobs/:id/artifact`가 받아 output 최상위 HTML을 덮어쓰되 첫 저장 때 `work/edit-backup/`에 원본을 백업한다. 수동 수정 사실은 `job.manualEdits`로 기록해 작업 페이지에 배지로 표시한다.

**Tech Stack:** Next.js 16 App Router, Mantine v9, zod(`readBody`), vitest 4 (+ happy-dom, 신규 devDep — DOM 직렬화 유닛 테스트용).

**Spec:** `docs/superpowers/specs/2026-08-07-viewer-inline-edit-design.md`

## Global Constraints

- 클라이언트 변경 요청은 반드시 `app/lib/request.ts`의 `requestJson`/`sendJson` 경유 — 맨 `fetch` + `.json()).error` 금지.
- 라우트 바디는 `lib/api-body.ts`의 `readBody(req, schema)`로 파싱.
- 사용자 노출 문구는 한국어. 이모지 아이콘 금지(인라인 SVG는 `app/components/icons.tsx`).
- Mantine v9: `Collapse`는 `expanded` prop, `Badge.extend` 금지, `variant="default"`는 `color` 무시.
- 편집 UI에 애니메이션/rAF 의존 동작을 넣지 않는다 (백그라운드 탭 검증 함정 — AGENTS.md).
- `app/` 밑에 `layout`/`page`/`route` 등 예약어 파일명 금지 (신규 파일은 `serialize.ts`, `EditPanel.tsx`).
- 커밋 메시지는 기존 히스토리처럼 한국어 conventional commit (`feat:`, `fix:`, `docs:`).

---

### Task 1: 직렬화 헬퍼 `serialize.ts` (순수 함수 + happy-dom 테스트)

**Files:**
- Create: `app/jobs/[id]/view/serialize.ts`
- Test: `app/jobs/[id]/view/serialize.test.ts`
- Modify: `package.json` (devDep `happy-dom` 추가)

**Interfaces:**
- Consumes: 없음 (독립 순수 모듈)
- Produces: `serializeEditedDocument(doc: Document): string` — 편집 흔적을 제거한 완전한 HTML 문서 문자열. 상수 `EDIT_STYLE_ID = "__mhm-edit-style"` (주입 스타일 요소 id), `SELECTED_ATTR = "data-mhm-selected"` (선택 표시 속성). Task 3의 뷰어가 세 가지 모두 import한다.

- [ ] **Step 1: happy-dom 설치**

Run: `pnpm add -D happy-dom`

- [ ] **Step 2: 실패하는 테스트 작성**

`app/jobs/[id]/view/serialize.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EDIT_STYLE_ID, SELECTED_ATTR, serializeEditedDocument } from "./serialize";

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("serializeEditedDocument", () => {
  it("편집 흔적(contenteditable, 주입 스타일, 선택 속성)을 모두 제거한다", () => {
    const doc = docFrom(
      `<!doctype html><html><head><style id="${EDIT_STYLE_ID}">[x]{}</style></head>` +
        `<body contenteditable="true"><td ${SELECTED_ATTR}="">본문</td></body></html>`,
    );
    const out = serializeEditedDocument(doc);
    expect(out).not.toContain("contenteditable");
    expect(out).not.toContain(EDIT_STYLE_ID);
    expect(out).not.toContain(SELECTED_ATTR);
    expect(out).toContain("본문");
  });

  it("doctype을 보존한다", () => {
    const out = serializeEditedDocument(docFrom("<!doctype html><html><body>x</body></html>"));
    expect(out.toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it("Outlook 조건부 주석을 보존한다", () => {
    const doc = docFrom(
      "<!doctype html><html><body><!--[if mso]><table><tr><td>mso</td></tr></table><![endif]-->본문</body></html>",
    );
    const out = serializeEditedDocument(doc);
    expect(out).toContain("<!--[if mso]>");
    expect(out).toContain("<![endif]-->");
  });

  it("원본 문서의 DOM을 변경하지 않는다 (클론에서 정리)", () => {
    const doc = docFrom(
      `<!doctype html><html><body contenteditable="true"><p ${SELECTED_ATTR}="">x</p></body></html>`,
    );
    serializeEditedDocument(doc);
    expect(doc.body.getAttribute("contenteditable")).toBe("true");
    expect(doc.querySelector(`[${SELECTED_ATTR}]`)).not.toBeNull();
  });

  it("인라인 스타일 수정 결과는 그대로 남는다", () => {
    const doc = docFrom('<!doctype html><html><body><p style="color: rgb(200, 100, 50);">x</p></body></html>');
    expect(serializeEditedDocument(doc)).toContain("color: rgb(200, 100, 50)");
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm exec vitest run app/jobs/[id]/view/serialize.test.ts`
Expected: FAIL — `./serialize` 모듈 없음.

- [ ] **Step 4: 구현**

`app/jobs/[id]/view/serialize.ts`:

```ts
/** 편집 모드가 iframe 문서에 주입하는 스타일 요소의 id. */
export const EDIT_STYLE_ID = "__mhm-edit-style";
/** 선택된 요소 표시(아웃라인용) 속성. */
export const SELECTED_ATTR = "data-mhm-selected";

/**
 * 편집 중인 iframe 문서를 저장용 HTML 문자열로 직렬화한다.
 * 편집 흔적(contenteditable, 주입 스타일, 선택 표시)은 클론에서 제거한다 —
 * 라이브 DOM을 건드리면 저장 실패 후 편집을 이어갈 수 없다.
 */
export function serializeEditedDocument(doc: Document): string {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  root.querySelector(`#${EDIT_STYLE_ID}`)?.remove();
  for (const el of root.querySelectorAll(`[${SELECTED_ATTR}]`)) el.removeAttribute(SELECTED_ATTR);
  root.querySelector("body")?.removeAttribute("contenteditable");

  const dt = doc.doctype;
  const doctype = dt
    ? `<!doctype ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : ""}${
        dt.systemId ? `${dt.publicId ? "" : " SYSTEM"} "${dt.systemId}"` : ""
      }>`
    : "";
  return `${doctype}\n${root.outerHTML}`;
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm exec vitest run app/jobs/[id]/view/serialize.test.ts`
Expected: PASS (5개)

- [ ] **Step 6: 커밋**

```bash
git add package.json pnpm-lock.yaml "app/jobs/[id]/view/serialize.ts" "app/jobs/[id]/view/serialize.test.ts"
git commit -m "feat(viewer): 편집 문서 직렬화 헬퍼 — 편집 흔적 제거 + doctype 보존"
```

---

### Task 2: 저장/복원 API — `PUT /api/jobs/:id/artifact`

**Files:**
- Create: `app/api/jobs/[id]/artifact/route.ts`
- Modify: `lib/jobs/store.ts:11-27` (Job 인터페이스에 `manualEdits` 필드)
- Test: `app/api/jobs/routes.test.ts` (기존 라우트 테스트 파일에 describe 추가)

**Interfaces:**
- Consumes: `lib/jobs/store.ts`의 `getJob(id)`, `updateJob(id, patch)`, `resolveArtifact(id, rel)`, `invalidateJobSize(id)`, `workDir(id)`; `lib/api-body.ts`의 `readBody(req, schema)`.
- Produces:
  - `Job.manualEdits?: Record<string, number>` — 파일명 → 마지막 수동 저장 시각(ms). Task 3(뷰어)·Task 4(배지)가 읽는다.
  - `PUT /api/jobs/:id/artifact` 바디 `{ file: string, html: string }` → 200 `{ saved: true }`; 바디 `{ file: string, restore: true }` → 200 `{ restored: true }`. 오류는 `{ error: string }` + 400/404/409/500.
  - 백업 위치: `work/edit-backup/<file>` (output 밖 — 산출물 목록/zip에 섞이지 않음).

- [ ] **Step 1: Job 타입에 manualEdits 추가**

`lib/jobs/store.ts`의 `Job` 인터페이스, `instruction?: string;` 줄 아래에:

```ts
  /** 뷰어에서 수동 저장한 산출물: 파일명 → 마지막 저장 시각(ms). restore 시 엔트리 제거. */
  manualEdits?: Record<string, number>;
```

- [ ] **Step 2: 실패하는 라우트 테스트 작성**

`app/api/jobs/routes.test.ts` — import 블록에 추가:

```ts
import { PUT as artifactRoute } from "./[id]/artifact/route";
```

`createJob, outputDir, updateJob, workDir` import 줄에 `getJob` 추가. 파일 하단에 describe 추가:

```ts
describe("PUT /api/jobs/:id/artifact", () => {
  const put = (body: unknown) =>
    new NextRequest("http://localhost/api", { method: "PUT", body: JSON.stringify(body) });
  const ORIGINAL = "<html><body>원본</body></html>";

  async function succeededJobWithHtml() {
    const job = await createJob(FIGMA_URL, "mock");
    await updateJob(job.id, { status: "succeeded" });
    await writeFile(path.join(outputDir(job.id), "edm_figma.html"), ORIGINAL);
    return job;
  }

  it("경로 탈출·비HTML·하위 경로를 거부한다", async () => {
    const job = await succeededJobWithHtml();
    for (const file of ["../job.json", "images/logo.png", "hosted/edm_figma.html", "note.txt", "a\\b.html"]) {
      const res = await artifactRoute(put({ file, html: "<html></html>" }), ctx(job.id));
      expect(res.status, file).toBe(400);
    }
  });

  it("실행 중인 잡은 409", async () => {
    const job = await createJob(FIGMA_URL, "mock"); // queued 상태 유지
    const res = await artifactRoute(put({ file: "edm_figma.html", html: "<html></html>" }), ctx(job.id));
    expect(res.status).toBe(409);
  });

  it("없는 산출물은 404", async () => {
    const job = await succeededJobWithHtml();
    const res = await artifactRoute(put({ file: "missing.html", html: "<html></html>" }), ctx(job.id));
    expect(res.status).toBe(404);
  });

  it("저장은 덮어쓰고, 백업은 첫 저장에만 만들고, manualEdits를 기록한다", async () => {
    const job = await succeededJobWithHtml();
    const backup = path.join(workDir(job.id), "edit-backup", "edm_figma.html");

    const res1 = await artifactRoute(put({ file: "edm_figma.html", html: "<html><body>v2</body></html>" }), ctx(job.id));
    expect(res1.status).toBe(200);
    expect(await readFile(path.join(outputDir(job.id), "edm_figma.html"), "utf8")).toContain("v2");
    expect(await readFile(backup, "utf8")).toBe(ORIGINAL);
    expect((await getJob(job.id))?.manualEdits?.["edm_figma.html"]).toBeTypeOf("number");

    // 두 번째 저장 — 백업은 여전히 최초 원본
    await artifactRoute(put({ file: "edm_figma.html", html: "<html><body>v3</body></html>" }), ctx(job.id));
    expect(await readFile(backup, "utf8")).toBe(ORIGINAL);
  });

  it("restore는 원본을 되돌리고 manualEdits 엔트리를 지운다", async () => {
    const job = await succeededJobWithHtml();
    await artifactRoute(put({ file: "edm_figma.html", html: "<html><body>수정</body></html>" }), ctx(job.id));

    const res = await artifactRoute(put({ file: "edm_figma.html", restore: true }), ctx(job.id));
    expect(res.status).toBe(200);
    expect(await readFile(path.join(outputDir(job.id), "edm_figma.html"), "utf8")).toBe(ORIGINAL);
    expect((await getJob(job.id))?.manualEdits?.["edm_figma.html"]).toBeUndefined();
  });

  it("백업이 없는 파일의 restore는 404", async () => {
    const job = await succeededJobWithHtml();
    const res = await artifactRoute(put({ file: "edm_figma.html", restore: true }), ctx(job.id));
    expect(res.status).toBe(404);
  });
});
```

`readFile`이 `node:fs/promises` import에 없으면 추가한다.

- [ ] **Step 3: 실패 확인**

Run: `pnpm exec vitest run app/api/jobs/routes.test.ts`
Expected: FAIL — `./[id]/artifact/route` 모듈 없음.

- [ ] **Step 4: 라우트 구현**

`app/api/jobs/[id]/artifact/route.ts`:

```ts
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api-body";
import { getJob, invalidateJobSize, resolveArtifact, updateJob, workDir } from "@/lib/jobs/store";

export const dynamic = "force-dynamic";

const schema = z.union([
  z.object({ file: z.string().min(1), html: z.string().min(1) }),
  z.object({ file: z.string().min(1), restore: z.literal(true) }),
]);

/**
 * PUT /api/jobs/:id/artifact — 뷰어 인라인 편집의 저장/복원.
 * output 최상위 .html만 허용: hosted/ 는 재생성 시 덮이고, images/ 는 대상이 아니다.
 * 첫 저장 때 원본을 work/edit-backup/ 에 백업한다 — output 밖에 두는 이유는
 * listArtifacts가 output을 재귀 순회해 백업이 산출물 목록·zip에 섞이기 때문.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  if (job.status === "queued" || job.status === "running") {
    return NextResponse.json(
      { error: "실행 중인 작업의 산출물은 수정할 수 없습니다." },
      { status: 409 },
    );
  }

  const r = await readBody(req, schema);
  if (!r.ok) return r.res;
  const { file } = r.data;

  // 최상위 .html만 — 구분자 검사는 양쪽 다 (Windows에서 \ 도 경로 구분자).
  if (file.includes("/") || file.includes("\\") || !file.endsWith(".html")) {
    return NextResponse.json(
      { error: "output 최상위의 .html 산출물만 수정할 수 있습니다." },
      { status: 400 },
    );
  }
  const full = resolveArtifact(id, file);
  if (!full) return NextResponse.json({ error: "잘못된 경로입니다." }, { status: 400 });

  const backupFile = path.join(workDir(id), "edit-backup", file);

  if ("restore" in r.data) {
    if (!existsSync(backupFile)) {
      return NextResponse.json({ error: "되돌릴 원본 백업이 없습니다." }, { status: 404 });
    }
    await copyFile(backupFile, full);
    const manualEdits = { ...job.manualEdits };
    delete manualEdits[file];
    await updateJob(id, {
      manualEdits: Object.keys(manualEdits).length > 0 ? manualEdits : undefined,
    });
    invalidateJobSize(id);
    return NextResponse.json({ restored: true });
  }

  if (!existsSync(full)) {
    return NextResponse.json({ error: "존재하지 않는 산출물입니다." }, { status: 404 });
  }
  if (!existsSync(backupFile)) {
    // 백업 실패 시 저장 중단 — 원본 보존이 저장보다 우선한다.
    try {
      await mkdir(path.dirname(backupFile), { recursive: true });
      await copyFile(full, backupFile);
    } catch {
      return NextResponse.json(
        { error: "원본 백업에 실패해 저장을 중단했습니다. 디스크 상태를 확인해 주세요." },
        { status: 500 },
      );
    }
  }
  await writeFile(full, r.data.html);
  await updateJob(id, { manualEdits: { ...job.manualEdits, [file]: Date.now() } });
  invalidateJobSize(id);
  return NextResponse.json({ saved: true });
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm exec vitest run app/api/jobs/routes.test.ts`
Expected: PASS (기존 + 신규 6개)

- [ ] **Step 6: 커밋**

```bash
git add lib/jobs/store.ts "app/api/jobs/[id]/artifact/route.ts" app/api/jobs/routes.test.ts
git commit -m "feat(api): 산출물 수동 저장/복원 라우트 — 첫 저장 백업 + manualEdits 기록"
```

---

### Task 3: 뷰어 편집 모드 (page.tsx 확장 + EditPanel)

**Files:**
- Modify: `app/jobs/[id]/view/page.tsx` (전면 수정 — 아래 전체 코드)
- Create: `app/jobs/[id]/view/EditPanel.tsx`

**Interfaces:**
- Consumes: Task 1의 `serializeEditedDocument`/`EDIT_STYLE_ID`/`SELECTED_ATTR`; Task 2의 `PUT /api/jobs/:id/artifact`와 `Job.manualEdits`; 기존 `app/lib/request.ts`(`requestJson`/`sendJson`), `app/lib/status.ts`(`isActive`), `GET /api/jobs/:id`(응답 `{ job: { status, manualEdits? } }`).
- Produces: 사용자 기능 — 편집 토글/저장/원본 복원. 다른 태스크가 소비하는 코드 인터페이스 없음.

설계 확정 사항 (스펙의 "구현 계획에서 확정" 항목): 굵기 포함 네 컨트롤 모두 **선택 요소의 인라인 스타일**을 수정한다. `execCommand` 선택 범위 방식은 패널 클릭으로 iframe 포커스가 빠지면 동작이 불안정해 채택하지 않는다. 패널은 `onMouseDown preventDefault`로 선택 해제를 막는다.

- [ ] **Step 1: EditPanel 작성**

`app/jobs/[id]/view/EditPanel.tsx`:

```tsx
"use client";

import { Button, Group, Paper, Text } from "@mantine/core";

export interface PanelTarget {
  el: HTMLElement;
  /** 스크롤 컨테이너 기준 절대 좌표 (요소 좌상단). */
  left: number;
  top: number;
}

/** "rgb(1, 2, 3)" → "#010203" — <input type="color">는 hex만 받는다. */
export function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "#000000";
  return `#${m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * 선택 요소의 인라인 스타일을 고치는 미니 패널. 부모 페이지에 절대 위치로 뜬다.
 * onMouseDown preventDefault — 패널 클릭이 iframe 포커스/선택을 뺏으면 안 된다.
 */
export default function EditPanel({
  target,
  onChange,
}: {
  target: PanelTarget;
  onChange: () => void;
}) {
  const { el } = target;
  const view = el.ownerDocument.defaultView;

  function bumpFontSize(delta: number) {
    if (!view) return;
    const size = parseFloat(view.getComputedStyle(el).fontSize) || 14;
    el.style.fontSize = `${Math.max(8, size + delta)}px`;
    onChange();
  }
  function toggleBold() {
    if (!view) return;
    const weight = parseInt(view.getComputedStyle(el).fontWeight, 10) || 400;
    el.style.fontWeight = weight >= 600 ? "400" : "700";
    onChange();
  }

  const computed = view?.getComputedStyle(el);
  return (
    <Paper
      shadow="md"
      p={6}
      radius="md"
      withBorder
      data-testid="edit-panel"
      style={{ position: "absolute", left: target.left, top: Math.max(0, target.top - 48), zIndex: 10 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Group gap={8} wrap="nowrap">
        <Text size="xs" c="dimmed" ff="monospace">
          {el.tagName.toLowerCase()}
        </Text>
        <Button variant="default" size="compact-xs" fw={700} onClick={toggleBold}>
          B
        </Button>
        <Button variant="default" size="compact-xs" onClick={() => bumpFontSize(-1)}>
          A−
        </Button>
        <Button variant="default" size="compact-xs" onClick={() => bumpFontSize(1)}>
          A＋
        </Button>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          글자
          <input
            type="color"
            defaultValue={computed ? rgbToHex(computed.color) : "#000000"}
            onChange={(e) => {
              el.style.color = e.currentTarget.value;
              onChange();
            }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          배경
          <input
            type="color"
            defaultValue={computed ? rgbToHex(computed.backgroundColor) : "#ffffff"}
            onChange={(e) => {
              el.style.backgroundColor = e.currentTarget.value;
              onChange();
            }}
          />
        </label>
      </Group>
    </Paper>
  );
}
```

- [ ] **Step 2: page.tsx 전면 수정**

`app/jobs/[id]/view/page.tsx` 전체를 다음으로 교체 (기존 `WIDTHS`·`CopyHtmlButton`은 유지):

```tsx
"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  Anchor,
  Button,
  Container,
  Group,
  Paper,
  SegmentedControl,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { isActive } from "../../../lib/status";
import { requestJson, sendJson } from "../../../lib/request";
import EditPanel, { type PanelTarget } from "./EditPanel";
import { EDIT_STYLE_ID, SELECTED_ATTR, serializeEditedDocument } from "./serialize";

const WIDTHS = [
  { label: "데스크톱 700", value: "700" },
  { label: "태블릿 600", value: "600" },
  { label: "모바일 375", value: "375" },
];

function CopyHtmlButton({ src }: { src: string }) {
  const [label, setLabel] = useState("HTML 복사");
  async function copy() {
    try {
      const html = await (await fetch(src)).text();
      await navigator.clipboard.writeText(html);
      setLabel("복사됨 ✓");
    } catch {
      setLabel("복사 실패");
    }
    setTimeout(() => setLabel("HTML 복사"), 2000);
  }
  return (
    <Button data-testid="copy-html" variant="default" size="compact-sm" onClick={copy}>
      {label}
    </Button>
  );
}

interface JobInfo {
  status: string;
  manualEdits?: Record<string, number>;
}

function Viewer() {
  const { id } = useParams<{ id: string }>();
  const file = useSearchParams().get("file") ?? "";
  const [width, setWidth] = useState("700");
  const [job, setJob] = useState<JobInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [target, setTarget] = useState<PanelTarget | null>(null);
  // restore/편집 취소 후 서버의 현재 파일로 강제 리로드하기 위한 키.
  const [frameNonce, setFrameNonce] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshJob = useCallback(async () => {
    if (!id) return;
    const r = await requestJson<{ job: JobInfo }>(`/api/jobs/${id}`);
    if (r.ok) setJob(r.data.job);
  }, [id]);

  useEffect(() => {
    void refreshJob();
  }, [refreshJob]);

  // 저장하지 않은 변경이 있으면 탭 닫기/새로고침 전에 경고.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const onInput = useCallback(() => setDirty(true), []);

  const onSelectionChange = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const frame = frameRef.current;
    const scroller = scrollRef.current;
    if (!doc || !frame || !scroller) return;
    const node = doc.getSelection()?.anchorNode;
    const el =
      node == null
        ? null
        : node.nodeType === Node.TEXT_NODE
          ? node.parentElement
          : (node as HTMLElement);
    for (const prev of doc.querySelectorAll(`[${SELECTED_ATTR}]`)) {
      if (prev !== el) prev.removeAttribute(SELECTED_ATTR);
    }
    if (!el || el === doc.body || el.nodeType !== Node.ELEMENT_NODE) {
      setTarget(null);
      return;
    }
    el.setAttribute(SELECTED_ATTR, "");
    const rect = el.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const scrollRect = scroller.getBoundingClientRect();
    setTarget({
      el,
      left: frameRect.left - scrollRect.left + scroller.scrollLeft + rect.left,
      top: frameRect.top - scrollRect.top + scroller.scrollTop + rect.top,
    });
  }, []);

  const enableEditing = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body) return;
    doc.body.setAttribute("contenteditable", "true");
    if (!doc.getElementById(EDIT_STYLE_ID)) {
      const style = doc.createElement("style");
      style.id = EDIT_STYLE_ID;
      style.textContent = `[${SELECTED_ATTR}] { outline: 2px solid #C4643B; outline-offset: 2px; }`;
      doc.head.appendChild(style);
    }
    doc.addEventListener("input", onInput);
    doc.addEventListener("selectionchange", onSelectionChange);
  }, [onInput, onSelectionChange]);

  if (!file) {
    return (
      <Container size={680} py={56}>
        <Text size="sm" c="dimmed">
          미리볼 파일이 지정되지 않았습니다.{" "}
          <Anchor href={`/jobs/${id}`}>작업 페이지로 돌아가기</Anchor>
        </Text>
      </Container>
    );
  }

  const src = `/api/jobs/${id}/preview/${file}${frameNonce ? `?v=${frameNonce}` : ""}`;
  // 편집 가능 = output 최상위 .html + 잡이 실행 중이 아님 (저장 API 허용 규칙과 동일).
  const editable =
    file.endsWith(".html") && !file.includes("/") && job !== null && !isActive(job.status);
  const hasBackup = Boolean(job?.manualEdits?.[file]);

  function reloadFrame() {
    setDirty(false);
    setTarget(null);
    setFrameNonce((n) => n + 1);
  }

  function toggleEdit() {
    if (!editing) {
      setEditing(true);
      enableEditing();
      return;
    }
    if (dirty && !window.confirm("저장하지 않은 변경이 사라집니다. 편집을 끝낼까요?")) return;
    setEditing(false);
    reloadFrame();
  }

  async function save() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    setSaving(true);
    try {
      const html = serializeEditedDocument(doc);
      const r = await sendJson(`/api/jobs/${id}/artifact`, "PUT", { file, html });
      if (!r.ok) {
        // 실패해도 편집 내용은 iframe에 그대로 남는다 — 재시도 가능.
        notifications.show({ message: r.error, color: "red" });
        return;
      }
      setDirty(false);
      notifications.show({ message: "저장했습니다." });
      void refreshJob();
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    if (!confirmRestore) {
      setConfirmRestore(true);
      return;
    }
    setConfirmRestore(false);
    const r = await sendJson(`/api/jobs/${id}/artifact`, "PUT", { file, restore: true });
    if (!r.ok) {
      notifications.show({ message: r.error, color: "red" });
      return;
    }
    reloadFrame();
    notifications.show({ message: "원본으로 되돌렸습니다." });
    void refreshJob();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--mantine-color-body)",
      }}
    >
      <Paper
        px="md"
        py={10}
        radius={0}
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Group gap="sm" wrap="nowrap">
          <Anchor
            href={`/jobs/${id}`}
            size="sm"
            onClick={(e) => {
              if (dirty && !window.confirm("저장하지 않은 변경이 있습니다. 나갈까요?"))
                e.preventDefault();
            }}
          >
            ← 작업으로
          </Anchor>
          <Text size="xs" c="dimmed" ff="monospace" truncate style={{ flex: 1, minWidth: 0 }}>
            {file}
            {editing && dirty ? " · 수정됨(미저장)" : ""}
          </Text>
          <SegmentedControl size="xs" value={width} onChange={setWidth} data={WIDTHS} />
          {editable && (
            <Button
              data-testid="edit-toggle"
              variant="default"
              size="compact-sm"
              onClick={toggleEdit}
            >
              {editing ? "편집 종료" : "편집"}
            </Button>
          )}
          {editing && (
            <Button
              data-testid="edit-save"
              size="compact-sm"
              onClick={save}
              loading={saving}
              disabled={!dirty}
            >
              저장
            </Button>
          )}
          {editable && hasBackup && (
            <Button
              data-testid="edit-restore"
              variant="light"
              color="red"
              size="compact-sm"
              onClick={restore}
            >
              {confirmRestore ? "정말 되돌릴까요?" : "원본으로 되돌리기"}
            </Button>
          )}
          <CopyHtmlButton src={src} />
          <Anchor href={src} target="_blank" size="sm">
            원본 열기
          </Anchor>
        </Group>
      </Paper>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          overflow: "auto",
          padding: 24,
          position: "relative", // EditPanel의 절대 위치 기준
        }}
      >
        <iframe
          key={frameNonce}
          ref={frameRef}
          data-testid="preview-frame"
          src={src}
          title="eDM preview"
          onLoad={() => {
            if (editing) enableEditing(); // restore 리로드 후에도 편집 유지
          }}
          style={{
            width: Number(width),
            minHeight: "100%",
            background: "#fff",
            border: "1px solid var(--mantine-color-default-border)",
            borderRadius: 10,
            transition: "width 200ms ease",
          }}
        />
        {editing && target && <EditPanel target={target} onChange={onInput} />}
      </div>
    </div>
  );
}

export default function ViewerPage() {
  return (
    <Suspense>
      <Viewer />
    </Suspense>
  );
}
```

- [ ] **Step 3: 타입·린트 확인**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 오류 없음. (주의: `node.parentElement`는 `HTMLElement | null` — 캐스트가 틀리면 여기서 잡힌다.)

- [ ] **Step 4: 수동 스모크 (mock provider)**

```bash
MHM_DATA_DIR=/tmp/mhm-edit-smoke pnpm dev
```

브라우저에서: mock 잡 생성 → 완료 후 산출물 "미리보기" → [편집] → 텍스트 타이핑 → 요소 클릭해 패널로 색 변경 → [저장] → 새로고침해 반영 확인 → [원본으로 되돌리기] → 원복 확인. 실행 중 잡의 뷰어에는 [편집]이 없어야 한다.

- [ ] **Step 5: 커밋**

```bash
git add "app/jobs/[id]/view/page.tsx" "app/jobs/[id]/view/EditPanel.tsx"
git commit -m "feat(viewer): 인라인 편집 모드 — contentEditable + 미니 스타일 패널 + 저장/복원"
```

---

### Task 4: 작업 페이지 배지 + 문서 + 최종 검증

**Files:**
- Modify: `app/jobs/[id]/page.tsx:23-35` (Job 인터페이스), `:341` 근처 (VerifyReport 주변 배지)
- Modify: `AGENTS.md` (Resume & targeted edits 불릿에 한 줄), `README.md` (기능 목록 한 줄)

**Interfaces:**
- Consumes: Task 2의 `Job.manualEdits`.
- Produces: 없음 (표시 전용).

- [ ] **Step 1: 배지 추가**

`app/jobs/[id]/page.tsx`의 로컬 `Job` 인터페이스에 `manualEdits?: Record<string, number>;` 추가. `{!running && <VerifyReport …/>}` 줄 바로 위에:

```tsx
{job?.manualEdits && Object.keys(job.manualEdits).length > 0 && (
  <Text size="xs" c="yellow" mt="md" data-testid="manual-edit-note">
    수동 수정됨: {Object.keys(job.manualEdits).join(", ")} — 아래 픽셀 검증 결과는 수정 전
    기준이며, 다른 산출물 파일과 어긋날 수 있습니다.
  </Text>
)}
```

- [ ] **Step 2: 문서 갱신**

`AGENTS.md`의 "**Resume & targeted edits**" 불릿 끝에 추가:

```
  Inline edit: the viewer (`/jobs/[id]/view`) can contentEditable-edit the
  top-level HTML deliverables in place (`PUT /api/jobs/:id/artifact`) — first
  save backs the original up to `work/edit-backup/` (outside output/, so it
  never shows in artifact lists or zips), `job.manualEdits` marks the file and
  relaxes nothing in the gate: verify badges show pre-edit results. Style ops
  are element-level inline styles, not selection-range execCommand (panel
  clicks steal iframe focus and make range commands unreliable).
```

`README.md` 기능/사용법 목록에 한 줄 (기존 문체에 맞춰):

```
- 미리보기에서 직접 수정: 산출물 미리보기 화면의 [편집]으로 문구·글자색·크기를 바로 고치고 저장할 수 있습니다. 첫 저장 시 원본이 백업되어 언제든 되돌릴 수 있습니다.
```

- [ ] **Step 3: 전체 검증**

```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Expected: 전부 통과. `acceptance.test.ts`가 전체 실행에서 깨지면 단독 재실행으로 플레이크 여부 확인 (AGENTS.md의 알려진 플레이크). `pnpm build`의 Turbopack NFT 경고 2건은 기존 알려진 경고.

- [ ] **Step 4: 커밋**

```bash
git add "app/jobs/[id]/page.tsx" AGENTS.md README.md
git commit -m "feat(job): 수동 수정 배지 + 인라인 편집 문서화"
```
