#!/usr/bin/env python3
import base64, os, sys

AS = os.path.join(os.environ.get("EDM_DIR", os.getcwd()), "assets")
COMPACT = "--compact" in sys.argv   # lightweight (<200KiB) build for Notion preview

def b64(name):
    ext = os.path.splitext(name)[1].lower()
    mime = "image/jpeg" if ext in (".jpg",".jpeg") else "image/png"
    with open(os.path.join(AS, name), "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode()

if COMPACT:
    hero, darkbanner = b64("c_hero.jpg"), b64("c_dark.jpg")
    c1, c2, c3, c4 = b64("c_card1.jpg"), b64("c_card2.jpg"), b64("c_card3.jpg"), b64("c_card4.jpg")
else:
    hero, darkbanner = b64("hero.png"), b64("darkbanner.png")
    c1, c2, c3, c4 = b64("card1_s.png"), b64("card2_s.png"), b64("card3_s.png"), b64("card4_s.png")
logo_blue = b64("logo_blue.png")
logo_white= b64("logo_white.png")
arrow     = b64("arrow.png")

FONT = "'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Segoe UI', Roboto, sans-serif"

if COMPACT:
    # use CDN font (progressive enhancement); falls back to system Korean font
    FONT_FACES = "@import url('https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard.min.css');"
else:
    with open(os.path.join(os.environ.get("EDM_DIR", os.getcwd()), "pretendard_faces.css"), encoding="utf-8") as _f:
        FONT_FACES = _f.read()

def card(title, line1, line2, img, iw, ih, align="right", valign="bottom"):
    return f"""
        <tr><td style="padding-bottom:18px;">
          <table role="presentation" width="620" height="136" cellpadding="0" cellspacing="0" border="0" class="card-tbl" style="width:620px;height:136px;background-color:#f4f7ff;border-radius:12px;">
            <tr>
              <td valign="middle" height="136" class="card-cell" style="height:136px;padding:0 0 0 30px;">
                <div class="card-title" style="font-family:{FONT};font-size:20px;font-weight:700;color:#0e4dff;line-height:1.2;">{title}</div>
                <div class="card-desc" style="font-family:{FONT};font-size:16px;font-weight:400;color:#343d53;line-height:1.45;padding-top:8px;">{line1}<br>{line2}</div>
              </td>
              <td valign="{valign}" align="{align}" width="173" height="136" class="card-imgcell" style="width:173px;height:136px;font-size:0;line-height:0;">
                <img src="{img}" width="{iw}" height="{ih}" alt="" class="card-img" style="display:block;border:0;width:{iw}px;height:{ih}px;{'border-bottom-right-radius:12px;' if align=='right' else ''}">
              </td>
            </tr>
          </table>
        </td></tr>"""

html = f"""<!doctype html>
<html lang="ko" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="format-detection" content="telephone=no">
<title>AISURFER Newsletter</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  {FONT_FACES}
  body{{margin:0;padding:0;background-color:#eceef3;}}
  table{{border-collapse:collapse;}}
  img{{-ms-interpolation-mode:bicubic;}}
  a{{text-decoration:none;}}
__MEDIA__
</style>
</head>
<body style="margin:0;padding:0;background-color:#eceef3;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">익숙한 방식 그대로, 더 편리해진 AI서퍼를 확인해보세요.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eceef3;">
<tr><td align="center" style="padding:0;">

<table role="presentation" class="container" width="700" cellpadding="0" cellspacing="0" border="0" style="width:700px;max-width:700px;background-color:#ffffff;">

  <!-- Header -->
  <tr><td class="px40" style="padding:29px 40px;border-bottom:1px solid #e5e8ee;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" valign="middle"><img src="{logo_blue}" width="150" height="27" alt="AISURFER" style="display:block;border:0;width:150px;height:27px;"></td>
      <td align="right" valign="middle" style="font-family:{FONT};font-size:12px;font-weight:700;letter-spacing:2px;color:#8a93be;">NEWSLETTER</td>
    </tr></table>
  </td></tr>

  <!-- Hero -->
  <tr><td style="padding:0;font-size:0;line-height:0;">
    <img src="{hero}" width="700" alt="수많은 뉴스, 이제 안 읽어도 됩니다. 익숙한 방식 그대로, 더 편리해진 AI서퍼를 확인해보세요." class="full-img" style="display:block;border:0;width:700px;max-width:100%;height:auto;">
  </td></tr>

  <!-- Intro -->
  <tr><td class="px40" style="background-color:#f9f9fb;padding:50px 40px;">
    <div class="sec-h" style="font-family:{FONT};font-size:24px;font-weight:700;color:#20283f;line-height:1.1;">EYESURFER가 <span style="color:#0e4dff;">AISURFER</span>로 새로워졌습니다</div>
    <div class="sec-body" style="font-family:{FONT};font-size:16px;font-weight:400;color:#343d53;line-height:1.6;padding-top:12px;">
      안녕하세요. 아이서퍼를 이용해주시는 분들께 항상 깊은 감사를 드립니다.<br>
      더 빠르고 편리한 뉴스 모니터링을 위해 아이서퍼가 AI서퍼(AISURFER)로 새로워졌습니다.<br>
      고객 여러분의 업무 방식을 다시 고민하며, 반복 업무는 줄이고 필요한 정보는 더 빠르게 확인할 수 있도록 서비스 전반을 업그레이드했습니다.
    </div>
  </td></tr>

  <!-- How you work now -->
  <tr><td class="px40" style="background-color:#ffffff;padding:50px 40px;">
    <div style="font-family:{FONT};font-size:12px;font-weight:700;letter-spacing:1.5px;color:#0e4dff;">HOW YOU WORK NOW</div>
    <div class="sec-h" style="font-family:{FONT};font-size:24px;font-weight:700;color:#20283f;line-height:1.2;padding-top:8px;padding-bottom:20px;">이제는 이렇게 일하세요</div>
    <table role="presentation" class="card-tbl" width="620" cellpadding="0" cellspacing="0" border="0" style="width:620px;">
      {card("읽지 않고, 결정하세요", "3,000여 개의 매체를 대신 분석하고,", "중요한 내용만 빠르게 확인할 수 있습니다.", c1, 169, 115, align="right")}
      {card("놓치지 않고, 대응하세요", "관심 키워드를 24시간 모니터링하고,", "중요한 이슈를 실시간으로 알려드립니다.", c2, 149, 125, align="right")}
      {card("쓰지 않고, 보고하세요", "스크랩부터 보고서 작성까지", "반복 업무를 줄여 더 중요한 일에 집중할 수 있습니다.", c3, 157, 117, align="right")}
      <tr><td style="padding-bottom:0;">
        <table role="presentation" width="620" height="136" cellpadding="0" cellspacing="0" border="0" class="card-tbl" style="width:620px;height:136px;background-color:#f4f7ff;border-radius:12px;">
          <tr>
            <td valign="middle" height="136" class="card-cell" style="height:136px;padding:0 0 0 30px;">
              <div class="card-title" style="font-family:{FONT};font-size:20px;font-weight:700;color:#0e4dff;line-height:1.2;">혼자 보지 말고, 함께 보세요</div>
              <div class="card-desc" style="font-family:{FONT};font-size:16px;font-weight:400;color:#343d53;line-height:1.45;padding-top:8px;">리포트를 손쉽게 공유하고<br>팀원들과 더욱 효율적으로 협업할 수 있습니다.</div>
            </td>
            <td valign="bottom" align="right" width="173" height="136" class="card-imgcell" style="width:173px;height:136px;font-size:0;line-height:0;">
              <img src="{c4}" width="136" height="120" alt="" class="card-img" style="display:block;border:0;width:136px;height:120px;border-bottom-right-radius:12px;">
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <!-- Dark banner -->
  <tr><td style="padding:0;font-size:0;line-height:0;background-color:#00030c;">
    <img src="{darkbanner}" width="700" alt="사용법은 그대로, 기능은 더 좋아졌습니다. 익숙한 화면과 사용 경험은 그대로 유지하면서, 더 편리해진 기능을 자연스럽게 활용하실 수 있도록 개선했습니다." class="full-img" style="display:block;border:0;width:700px;max-width:100%;height:auto;">
  </td></tr>

  <!-- CTA -->
  <tr><td class="px40" align="center" style="background-color:#ffffff;padding:49px 40px 46px;">
    <div class="sec-h" style="font-family:{FONT};font-size:24px;font-weight:700;color:#0e4dff;line-height:1.2;">무엇이 달라졌는지 직접 확인해보세요</div>
    <div class="sec-body" style="font-family:{FONT};font-size:16px;font-weight:400;color:#5b6480;line-height:1.35;padding-top:12px;">새로워진 AI서퍼의 다양한 기능과 활용 방법을 홈페이지에서 소개해드리고 있습니다.</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:30px auto 0;"><tr>
      <td align="center" bgcolor="#0e4dff" style="border-radius:100px;">
        <a href="https://intro.aisurfer.com/" target="_blank" style="display:inline-block;font-family:{FONT};font-size:16px;font-weight:700;color:#ffffff;line-height:20px;padding:18px 34px;border-radius:100px;">
          <span style="vertical-align:middle;">새로워진 AI서퍼 확인하기</span>
          <img src="{arrow}" width="23" height="16" alt="" style="display:inline-block;vertical-align:middle;margin-left:8px;border:0;width:23px;height:16px;">
        </a>
      </td>
    </tr></table>
    <div style="padding-top:30px;">
      <a href="https://intro.aisurfer.com/" target="_blank" style="font-family:{FONT};font-size:14px;font-weight:600;color:#2b6fff;">https://intro.aisurfer.com/</a>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td class="px40" style="background-color:#001758;padding:40px 40px 37px;">
    <img src="{logo_white}" width="167" height="30" alt="AISURFER" style="display:block;border:0;width:167px;height:30px;">
    <div style="font-family:{FONT};font-size:16px;font-weight:300;color:#c5cff7;line-height:1.35;padding-top:12px;">정보를 넘어 방향까지 · AI 에이전트가 일하는 미디어 인텔리전스 플랫폼</div>
    <div style="border-top:1px solid #24439c;font-size:0;line-height:0;margin-top:20px;">&nbsp;</div>
    <div style="font-family:{FONT};font-size:12px;font-weight:400;color:#abb9ec;padding-top:20px;">© 2026 BECUAI Corp. All rights reserved.</div>
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>"""

# ---- Media strategies -------------------------------------------------------
# v1 (Figma-identical): fixed 700px. Only a graceful downscale so it never breaks
# on a narrow viewport, but at >=700px it is byte-for-byte the verified layout.
MEDIA_FIGMA = """  @media only screen and (max-width:700px){
    .container{width:100% !important;}
    .full-img{width:100% !important;height:auto !important;}
  }"""

# v2 (Responsive): full desktop -> tablet -> mobile adaptation.
MEDIA_RESPONSIVE = """  @media only screen and (max-width:700px){
    .container{width:100% !important;}
    .full-img{width:100% !important;height:auto !important;}
    .card-tbl{width:100% !important;}
  }
  @media only screen and (max-width:600px){
    .px40{padding-left:26px !important;padding-right:26px !important;}
    .card-cell{padding-left:24px !important;}
  }
  @media only screen and (max-width:480px){
    .px40{padding:36px 20px !important;}
    .sec-h{font-size:21px !important;}
    .sec-body{font-size:15px !important;}
    .card-tbl{height:auto !important;}
    .card-cell{height:auto !important;padding:18px 8px 18px 20px !important;}
    .card-title{font-size:17px !important;}
    .card-desc{font-size:14px !important;line-height:1.4 !important;}
    .card-imgcell{width:104px !important;}
    .card-img{width:104px !important;height:auto !important;}
  }
  @media only screen and (max-width:360px){
    .card-desc{font-size:13px !important;}
    .card-imgcell{width:84px !important;}
    .card-img{width:84px !important;}
  }"""

if COMPACT:
    import re
    doc = html.replace("__MEDIA__", MEDIA_RESPONSIVE)
    if "--minify" in sys.argv:
        doc = re.sub(r"\n\s*", "", doc)          # collapse to a single line
    p = os.path.join(os.environ.get("EDM_DIR", os.getcwd()), "aisurfer_compact.html")
    with open(p, "w", encoding="utf-8") as f:
        f.write(doc)
    print(f"WROTE {p}  ({round(len(doc.encode('utf-8'))/1024)} KiB, lines={doc.count(chr(10))+1})")
    sys.exit(0)

DL = os.path.expanduser("~/Downloads")
outputs = [
    ("aisurfer_newsletter_figma.html", MEDIA_FIGMA),
    ("aisurfer_newsletter_responsive.html", MEDIA_RESPONSIVE),
]
for fname, media in outputs:
    doc = html.replace("__MEDIA__", media)
    p = os.path.join(DL, fname)
    with open(p, "w", encoding="utf-8") as f:
        f.write(doc)
    print(f"WROTE {p}  ({round(len(doc.encode('utf-8'))/1024)} KB)")

# keep legacy filename pointing at the identical version too
_leg = os.path.join(DL, "aisurfer_newsletter.html")
with open(_leg, "w", encoding="utf-8") as f:
    f.write(html.replace("__MEDIA__", MEDIA_FIGMA))
