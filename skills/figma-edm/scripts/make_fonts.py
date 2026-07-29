#!/usr/bin/env python3
"""Subset Pretendard weights to glyphs used in the email, base64 -> @font-face CSS."""
import subprocess, base64, os, re, sys

SP = os.environ.get("EDM_DIR", os.getcwd())
FD = os.path.join(SP, "fonts")

# All human-readable text that renders as real HTML text (not baked into images).
TEXT = """
NEWSLETTER
EYESURFER가 AISURFER로 새로워졌습니다
안녕하세요. 아이서퍼를 이용해주시는 분들께 항상 깊은 감사를 드립니다.
더 빠르고 편리한 뉴스 모니터링을 위해 아이서퍼가 AI서퍼(AISURFER)로 새로워졌습니다.
고객 여러분의 업무 방식을 다시 고민하며, 반복 업무는 줄이고 필요한 정보는 더 빠르게 확인할 수 있도록 서비스 전반을 업그레이드했습니다.
HOW YOU WORK NOW
이제는 이렇게 일하세요
읽지 않고, 결정하세요
3,000여 개의 매체를 대신 분석하고, 중요한 내용만 빠르게 확인할 수 있습니다.
놓치지 않고, 대응하세요
관심 키워드를 24시간 모니터링하고, 중요한 이슈를 실시간으로 알려드립니다.
쓰지 않고, 보고하세요
스크랩부터 보고서 작성까지 반복 업무를 줄여 더 중요한 일에 집중할 수 있습니다.
혼자 보지 말고, 함께 보세요
리포트를 손쉽게 공유하고 팀원들과 더욱 효율적으로 협업할 수 있습니다.
무엇이 달라졌는지 직접 확인해보세요
새로워진 AI서퍼의 다양한 기능과 활용 방법을 홈페이지에서 소개해드리고 있습니다.
새로워진 AI서퍼 확인하기
https://intro.aisurfer.com/
정보를 넘어 방향까지 · AI 에이전트가 일하는 미디어 인텔리전스 플랫폼
궁금하신 사항은 언제든지 편하게 문의해 주세요.
© 2026 BECUAI Corp. All rights reserved.
"""
chars = sorted(set(TEXT) - {"\n"})
# ensure basic ascii + common punctuation present
extra = list("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,()·©/:-")
charset = "".join(sorted(set(chars) | set(extra)))
print(f"unique glyphs: {len(charset)}")

WEIGHTS = [("Light",300),("Regular",400),("SemiBold",600),("Bold",700),("ExtraBold",800)]
css = []
total = 0
for name, wt in WEIGHTS:
    src = os.path.join(FD, f"Pretendard-{name}.woff2")
    out = os.path.join(FD, f"sub-{name}.woff2")
    subprocess.run([sys.executable,"-m","fontTools.subset", src, f"--text={charset}",
        "--flavor=woff2", "--layout-features=*", f"--output-file={out}"],
        check=True, capture_output=True)
    b = open(out,"rb").read(); total += len(b)
    print(f"  {name:10s} {len(b)/1024:6.1f} KB")
    b64 = base64.b64encode(b).decode()
    css.append(f"""@font-face{{font-family:'Pretendard';font-style:normal;font-weight:{wt};font-display:swap;src:url(data:font/woff2;base64,{b64}) format('woff2');}}""")
print(f"TOTAL subset fonts: {total/1024:.1f} KB")
open(os.path.join(SP,"pretendard_faces.css"),"w").write("\n".join(css))
print("wrote pretendard_faces.css")
