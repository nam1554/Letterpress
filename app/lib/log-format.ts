/**
 * 진행 로그 한 줄을 표시용 세그먼트로 쪼갠다. **표시 계층 전용** —
 * `data/jobs/<id>/events.ndjson`은 건드리지 않는다. 그래서 이미 보관된 잡의
 * 로그도 소급해서 읽기 좋아지고, 파이프라인/프롬프트에는 아무 위험이 없다.
 *
 * 왜 필요한가 (보관된 잡 8건, 이벤트 356건 실측):
 * - 절대경로가 105건(전체의 30%)에 박혀 있다. 한 줄이
 *   `/Users/example/projects/letterpress/data/jobs/
 *   00ae9d9a/work/output/x.html` 인데 정작 쓸모 있는 부분은 `output/x.html`뿐이다.
 * - 마크다운 문법이 그대로 찍힌다: 백틱 191회, `**bold**` 46회, 링크 12회.
 *   LogViewer가 평문을 그리므로 기호가 글자로 보인다.
 *
 * 전체 경로는 버리지 않는다 — 세그먼트가 `full`을 들고 있어 호버·복사로 닿는다.
 */

/** 굵게 표시할지. 강조 안에 코드/경로가 들어간 경우를 담기 위한 수정자다. */
interface Emphasis {
  strong?: boolean;
}

export type LogSegment = Emphasis &
  (
    | /** 그냥 글자 */ { kind: "text"; text: string }
    | /** `백틱` 안이었던 것 — 기호는 떼고 색으로 구분 */ { kind: "code"; text: string }
    | /** 파일 경로 — `text`는 줄인 것, `full`은 원본 */ {
        kind: "path";
        text: string;
        full: string;
      }
    | /** URL — 안쪽 경로가 잘리지 않게 따로 잡아 둔다 */ { kind: "url"; text: string }
    | /** `[라벨](경로)` — 라벨과 (줄인) 대상을 함께 보여준다 */ {
        kind: "link";
        text: string;
        target: string;
        full: string;
      }
  );

/**
 * 잡 작업 디렉터리 접두사. id는 8-hex(jobDir 규약)라 레포 위치를 몰라도 잡힌다.
 * 구분자는 `[\\/]` 둘 다 받는다 — Windows에서 로그의 경로는 역슬래시로 찍힌다.
 */
const JOB_WORK_PREFIX = /^.*?[\\/]data[\\/]jobs[\\/][0-9a-f]{8}[\\/](?:work[\\/])?/;

/** 경로 구분자 (POSIX·Windows 공용). */
const SEP = /[\\/]/;

/**
 * 절대 경로. 한글·닫는 괄호·쉼표를 물지 않도록 문자 클래스를 좁혔다.
 * `C:\…` 드라이브 문자도 받는다 — 그러지 않으면 Windows에서는 경로가 아예 인식되지
 * 않아, 로그 이벤트의 30%를 차지하는 절대경로 축약이 통째로 동작하지 않는다.
 */
const ABS_PATH = /(?:[A-Za-z]:[\\/]|\/)(?:[A-Za-z0-9._\-@+]+[\\/])*[A-Za-z0-9._\-@+]+/g;

/**
 * 마크다운 토큰.
 *
 * 주의: 정규식 교대(alternation)는 **위치 우선**이라 여기 나열한 순서가 우선순위가
 * 아니다. 왼쪽에서 먼저 만난 토큰이 이긴다. 그래서 실제 로그에 흔한
 * `` **`verify.json` = PASS** `` 처럼 강조가 코드를 감싼 경우, 강조가 먼저 잡히고
 * 안쪽 백틱이 글자로 남았다 — 아래 `tokenize`가 강조 내용을 한 번 더 파싱해 해결한다.
 */
const TOKENS = new RegExp(
  [
    // 인라인 토큰은 줄을 넘지 않는다. `\r`도 막는다 — Windows 로그는 CRLF라
    // `\n`만 막으면 코드 스팬 안에 CR이 들어가 화면에서 줄이 어긋난다.
    /\[([^\]\r\n]+)\]\(<([^>\r\n]+)>\)/, // [라벨](<경로>) — 에이전트가 쓰는 형태
    /\[([^\]\r\n]+)\]\(([^)\s]+)\)/, //    [라벨](경로)
    /`([^`\r\n]+)`/, //                    `코드`
    /\*\*([^*\r\n]+)\*\*/, //              **강조**
    // 맨 URL. 로그의 URL은 대부분 셸 명령 안에서 홑따옴표로 감싸여 있어
    // (`curl -o x 'https://…'`) 따옴표를 제외하지 않으면 닫는 따옴표까지 문다.
    /(https?:\/\/[^\s)>\]",';]+)/,
  ]
    .map((r) => r.source)
    .join("|"),
  "g",
);

/**
 * 경로를 읽을 수 있는 길이로 줄인다. 줄일 게 없으면 입력을 그대로 돌려준다.
 */
export function shortenPath(raw: string): string {
  // 1) 잡 작업 디렉터리 안이면 그 아래 상대경로만 남긴다 — 가장 흔한 경우.
  //    표시용이므로 구분자는 `/`로 통일한다 (원본은 세그먼트의 `full`에 남는다).
  const inJob = raw.replace(JOB_WORK_PREFIX, "");
  if (inJob !== raw) return inJob.split(SEP).join("/") || raw;

  // 2) 그 밖의 긴 절대경로는 뒤 두 조각만. 짧은 것(`/mcp`, `/api/mcp`)은 건드리지
  //    않는다 — 줄여도 얻는 게 없고 뜻만 흐려진다.
  //    주의: 서로 다른 경로가 같은 꼬리를 가지면 표시가 같아질 수 있다
  //    (`/a/b/c/d/images/hero.png`와 `/x/y/z/w/images/hero.png` → 둘 다
  //    `…/images/hero.png`). 원본이 `full`에 남아 호버로 구분되므로 감수한다.
  const isAbsolute = raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw);
  const parts = raw.split(SEP).filter(Boolean);
  if (isAbsolute && parts.length > 4) return `…/${parts.slice(-2).join("/")}`;
  return raw;
}

/** text/code 조각 안의 절대경로를 path 세그먼트로 분리한다. */
function splitPaths(text: string, kind: "text" | "code", em: Emphasis): LogSegment[] {
  const out: LogSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(ABS_PATH)) {
    const full = m[0];
    const short = shortenPath(full);
    // 줄어들지 않는 경로는 굳이 별도 세그먼트로 만들지 않는다.
    if (short === full) continue;
    if (m.index > last) out.push({ kind, text: text.slice(last, m.index), ...em });
    out.push({ kind: "path", text: short, full, ...em });
    last = m.index + full.length;
  }
  if (last < text.length) out.push({ kind, text: text.slice(last), ...em });
  return out;
}

/**
 * 재귀 깊이는 최대 2다: `**강조**`의 내용은 `[^*\n]+`라 그 안에 다시 `**`가 올 수
 * 없으므로, 강조 안에서 한 번 더 파싱해도 또 강조를 만나지 않는다.
 */
/**
 * `[라벨](대상)` 하나를 세그먼트로. 라벨이 줄인 대상과 같으면 링크가 아니라 경로로
 * 낸다 — 그러지 않으면 `verify.json (verify.json)` 처럼 같은 말이 두 번 나온다
 * (실제 로그에 흔한 형태다).
 */
function linkSegment(label: string, target: string, em: Emphasis): LogSegment {
  const short = shortenPath(target);
  if (label === short) return { kind: "path", text: short, full: target, ...em };
  return { kind: "link", text: label, target: short, full: target, ...em };
}

function tokenize(raw: string, em: Emphasis): LogSegment[] {
  const out: LogSegment[] = [];
  let last = 0;

  for (const m of raw.matchAll(TOKENS)) {
    if (m.index > last) out.push(...splitPaths(raw.slice(last, m.index), "text", em));
    const [, angleLabel, angleTarget, plainLabel, plainTarget, code, strong, url] = m;

    if (angleLabel !== undefined && angleTarget !== undefined) {
      out.push(linkSegment(angleLabel, angleTarget, em));
    } else if (plainLabel !== undefined && plainTarget !== undefined) {
      out.push(linkSegment(plainLabel, plainTarget, em));
    } else if (code !== undefined) {
      out.push(...splitPaths(code, "code", em));
    } else if (strong !== undefined) {
      // 강조 안의 코드·경로까지 살린다 (`**`verify.json` = PASS**`).
      out.push(...tokenize(strong, { ...em, strong: true }));
    } else if (url !== undefined) {
      out.push({ kind: "url", text: url, ...em });
    }
    last = m.index + m[0].length;
  }

  if (last < raw.length) out.push(...splitPaths(raw.slice(last), "text", em));
  return out;
}

/**
 * 로그 한 줄 → 표시용 세그먼트 배열. 어떤 입력에도 던지지 않는다(로그 렌더링이
 * 잡 화면을 깨뜨려선 안 된다). 빈 문자열이면 빈 배열.
 */
export function formatLogLine(raw: string): LogSegment[] {
  if (!raw) return [];
  return tokenize(raw, {});
}
