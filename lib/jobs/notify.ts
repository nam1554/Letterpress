import { spawn } from "node:child_process";
import { getSettings } from "../settings";

/**
 * 잡 종료를 macOS 알림센터로 알린다 — 변환이 10~25분 걸리므로 탭을 계속 보고
 * 있지 않아도 되게. 브라우저 권한이 필요 없고 탭이 닫혀 있어도 동작한다.
 * 알림은 부가 기능: 어떤 실패도 잡 상태로 전파하지 않는다(appendEvent와 같은
 * 최선 노력 원칙).
 */
export function notifyJobFinished(job: { id: string; status: string; title?: string }): void {
  try {
    if (!getSettings().notifyOnFinish || process.platform !== "darwin") return;
    const ok = job.status === "succeeded";
    const title = ok ? "Letterpress — 변환 완료" : "Letterpress — 변환 실패";
    const body = job.title || job.id;
    const p = spawn(
      "osascript",
      [
        "-e",
        `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} sound name "Glass"`,
      ],
      { stdio: "ignore", detached: true },
    );
    p.on("error", () => {});
    p.unref();
  } catch {
    /* 알림 실패는 무시 */
  }
}
