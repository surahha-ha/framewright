# 편집기 사용자 불만 조사 — framewright 설계 입력

- 조사일: 2026-08-13
- 대상: Premiere Pro · Final Cut Pro · DaVinci Resolve · CapCut · Clipchamp ·
  Canva · Kapwing · VEED · Descript · WeVideo · iMovie
- 목적: **비전문가용** 브라우저 편집기인 framewright 가 무엇을 고칠 수 있고,
  무엇을 더 나쁘게 만들고, 무엇이 본질적인지 가리는 것.

이 문서는 서술적(descriptive) 문서다. 코드와 어긋나면 코드가 옳고, 이 문서를
고친다. 다만 마지막 "무엇을 하자" 절은 **제안**이지 결정이 아니다. ADR 로
올라가기 전까지는 아무것도 확정되지 않았다.

---

## 요약 — 다섯 줄

1. 사람들이 편집기를 버릴 때 쓰는 단어("brutal", "unforgivable", "starting from
   scratch")는 **기능 부족이 아니라 작업물 소실과 침묵한 실패**에서 나온다.
2. 그중 두 가지 — **export 가 preview 와 다르다**, **실패했는데 이유를 안
   말한다** — 는 framewright 의 golden rule 7 과 ADR-0002 가 구조적으로 막는
   것이고, 우리가 실제로 이길 수 있는 신뢰다.
3. 브라우저 편집기 고유의 위험 세 가지는 **저장소가 곧 세이브 파일**,
   **미디어 재업로드/재선택**, **남의 서버에서 도는 export** 다. 우리는 세 번째를
   구조적으로 이겼고, 앞의 두 개는 **지금 갖고 있다**.
4. 조사 중 코드와 대조해 **기존 tech debt 에 없던 결함 두 개**가 나왔다 —
   백그라운드 탭에서 export 가 사실상 멈추는 문제(4-1)와 ADR-0004 가 지시한
   OPFS 가 미구현이라는 사실(4-2).
5. **ADR-0006(자동 reflow 거부)은 유지한다.** 다만 초보자 쪽에서 정반대 증거가
   하나 나왔고, 그에 대한 답은 ADR 을 뒤집는 게 아니라 이미 옳게 구현된
   `clip.paste` 를 **발견 가능하게** 만드는 것이다 (G10).

---

## 0. 조사 방법과, 이 조사가 못 한 것

먼저 한계부터 적는다. 아래 판단의 신뢰도가 여기에 달려 있다.

**Reddit 을 대부분 못 읽었다 — 한 갈래만 빼고.** `reddit.com` 은 WebSearch 의
도메인 필터에서 거부되고 (`domains not accessible to our user agent`),
`old.reddit.com` 은 WebFetch 가 차단당한다. 그래서 Premiere / FCP / Resolve /
iMovie 항목의 Reddit 인용은 **스레드 제목과 검색 스니펫뿐**이다 — "얼마나 자주
나오는가"는 신뢰할 수 있지만 "정확히 뭐라고 썼는가"는 신뢰할 수 없다. 해당
항목은 `[스니펫]` 으로 표시했다.

**예외: CapCut 은 원문을 읽었다.** Reddit 의 **RSS 엔드포인트**(서브레딧
`top.rss`/`new.rss`, `search.rss`, 스레드별 댓글 `.rss`)는 아직 살아 있다.
Google Play 리뷰는 Play 의 `batchexecute` 리뷰 RPC 로 최신 200건 + "most
relevant" 100건 + 1★ 100건(2026-07~08)을 받았다. 그래서 **G13(CapCut)의 인용은
이 문서에서 가장 신뢰도가 높다.** 다음에 이 조사를 이어받는 사람은 다른
제품에도 같은 RSS 경로를 쓰면 된다 — 이 문서의 가장 큰 공백이 그걸로 메워진다.

**G2 는 전부 실패했다.** 403 이다. 이 문서의 G2 수치는 검색 스니펫이며
**인용 금지**로 취급해야 한다.

**Trustpilot 은 텍스트 추출 프록시(`r.jina.ai`)를 거쳐 읽었다.** 직접 접속은
모든 호스트에서 403 이다. 수치는 렌더링된 실제 페이지 텍스트이지만 제3자
프록시를 한 번 거쳤으므로 Apple API 데이터보다 한 단계 낮은 신뢰도다.

**WebSearch 예산 200 회를 소진했다.** 후반부 몇 갈래는 의도보다 얇다.

**1차 접근에 성공한 곳** (이 문서 증거의 대부분): Adobe Community(포럼·버그
리포트), Apple Discussions, Blackmagic Design 포럼(프록시 경유), Microsoft
Q&A / learn.microsoft.com, Microsoft 공식 지원 문서, Creative COW, Capterra /
GetApp / SoftwareAdvice, Product Hunt, Apple App Store 조회 API,
PissedConsumer, Descript feedback 보드, 그리고 개발사 자신의 도움말 문서.

마지막 항목이 의외로 가장 강한 증거였다. **벤더가 자기 지원 문서에서 인정한
제약**은 사용자 불평보다 반박하기 어렵다.

---

## 1. 숫자로 본 시장

### 1-A. 리뷰 수와 평점

관측일 2026-08-13. `찾지 못함` 은 추정하지 않았다는 뜻이다.

| 제품                         | 플랫폼                |       리뷰 수 |     평균 |       1–2★ 비율 | 신뢰도                     |
| ---------------------------- | --------------------- | ------------: | -------: | --------------: | -------------------------- |
| Canva                        | Google Play           |    26,048,043 |     4.77 |            3.0% | 중 (미러, 2026-07-15 기준) |
| Canva                        | Apple App Store       |     3,485,440 |    4.875 |       찾지 못함 | **상** (1차 API)           |
| CapCut                       | Google Play           |    12,843,158 | **3.56** |       **32.4%** | 중 (미러)                  |
| CapCut                       | Apple App Store       |     1,117,161 |     4.61 |       찾지 못함 | **상** (1차 API)           |
| CapCut                       | Microsoft Store       |        85,004 |      4.8 | 히스토그램 없음 | 중                         |
| CapCut                       | Trustpilot            |        ~1,000 |  **1.2** |       찾지 못함 | 하 (프록시·사이드바)       |
| iMovie                       | Apple App Store (iOS) |       303,645 |    4.406 |       찾지 못함 | **상** (1차 API)           |
| Premiere Rush                | Google Play           |        37,201 | **3.12** |       **43.9%** | 중 (미러)                  |
| Clipchamp                    | Trustpilot            |     **6,471** |  **4.7** |              7% | 중 (프록시)                |
| Clipchamp                    | Microsoft Store       |        21,728 |      4.7 | 히스토그램 없음 | 중                         |
| Clipchamp                    | Capterra              |           101 |      4.3 |            5.0% | **상** (실시간)            |
| VEED                         | Trustpilot            |         3,800 |      4.2 |         **18%** | 중 (프록시)                |
| VEED                         | Capterra              |            62 |  **3.2** |       **37.1%** | **상** (실시간)            |
| Kapwing                      | Capterra              |           207 |      4.4 |        **9.7%** | **상** (실시간)            |
| Premiere Pro                 | Capterra              |           573 |      4.7 |            0.7% | **상** (실시간)            |
| DaVinci Resolve              | Capterra              |           271 |      4.8 |             ~0% | **상** (실시간)            |
| Final Cut Pro                | Capterra              |           143 |      4.7 |             ~0% | **상** (실시간)            |
| iMovie                       | Capterra              |           428 |      4.5 |             ~1% | **상** (실시간)            |
| Canva                        | Capterra              |        13,401 |      4.7 |           ~0.4% | **상** (실시간)            |
| Blackmagic Design            | Trustpilot            |     찾지 못함 |  **2.6** |       찾지 못함 | 하 (프록시)                |
| Adobe (전사)                 | Trustpilot            |         7,367 |      1.2 |       찾지 못함 | 하 (프록시)                |
| Premiere Pro / FCP / Resolve | **Mac App Store**     | **취득 불가** |        — |               — | —                          |

**Mac App Store 는 계통적으로 못 읽는다.** FCP·iMovie·Resolve 모두
`userRatingCount: 0` 을 돌려주는데, **Microsoft Word 도 똑같이 0 을 돌려준다.**
즉 평점이 없는 게 아니라 API 가 안 주는 것이다. "Mac 앱은 리뷰가 없다"고 읽으면
안 된다.

### 1-B. 가격 (2026-08-13 벤더 페이지 직접 확인)

아래는 전부 **vendor** 등급(개발사 자기 가격 페이지)이라 신뢰도가 높다.

| 제품                          | 요금                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Premiere Pro**              | 단일 앱 **$22.99/월**(연간 약정 월납) · 연간 선납 **$263.88/년** · Creative Cloud Pro **$69.99/월**(첫 3개월 $34.99) · 학생/교사 첫 해 $19.99/월 → 이후 $39.99/월 · Teams $37.99/월/라이선스            |
| **Final Cut Pro (Mac)**       | **$299.99 1회 구매** (구독·IAP 없음). v12.3, 2026-06-30 릴리스                                                                                                                                          |
| **Apple Creator Studio**      | **$12.99/월** 또는 **$129/년** (학생 $2.99/월). 2026-01-28 출시. FCP·Logic·Motion·Compressor·Pixelmator Pro 묶음. **1회 구매 $299.99 는 여전히 병존**                                                   |
| **DaVinci Resolve**           | **무료** (전체 애플리케이션). 8-bit 포맷, 최대 60fps, **UHD 3840×2160 상한**                                                                                                                            |
| **DaVinci Resolve Studio 21** | **$295 1회 구매**. 32K/120fps, Neural Engine, Resolve FX 45종 추가, Dolby Vision/HDR10+                                                                                                                 |
| **CapCut**                    | iOS 인앱 구독 **월 $7.99–$19.99**, **연 $89.99**. **웹/데스크톱 가격은 벤더에서 찾지 못함** — `capcut.com/pricing` 과 `/plans` 모두 404 이고, 자체 도움말은 "지역·기기·프로모션에 따라 다르다"고만 한다 |
| **Clipchamp**                 | 무료 티어: **프로젝트·export 무제한, 1080p, watermark 없음**. 유료는 Microsoft 365 로 제공 — Personal $9.99/월($99.99/년), Family $12.99/월($129.99/년). 단독 Premium 가격은 확인 실패                  |
| **Canva**                     | 무료 $0 · Pro **$180/년** · Business **$250/년/인** · Enterprise 별도. 월 단위 요금은 페이지에 표기 없음                                                                                                |
| **Kapwing**                   | 무료: **월 30분 export, 영상 4분 상한, 720p, watermark, 저장 3일, 크레딧 10** · Pro **$16/월(연납, $192/년)** 또는 $24/월 · Business **$50/월(연납, $600/년)**                                          |
| **VEED**                      | Creator **$12/월(연납, $147/년)** · Pro **$24/월($288/년)** · Studio **$39/월($465/년)**. 무료 티어 한도와 월납 요금은 페이지에 없음                                                                    |
| **iMovie**                    | **무료**, macOS/iOS 번들. 유료 티어 없음                                                                                                                                                                |

출처: [Adobe](https://www.adobe.com/products/premiere/plans.html) ·
[FCP](https://apps.apple.com/us/app/final-cut-pro/id424389933) ·
[Creator Studio](https://www.apple.com/apple-creator-studio/) ·
[Resolve](https://www.blackmagicdesign.com/products/davinciresolve) ·
[CapCut](https://apps.apple.com/us/app/capcut-video-editor/id1500855883) ·
[Clipchamp](https://clipchamp.com/en/pricing/) ·
[Canva](https://www.canva.com/pricing/) ·
[Kapwing](https://www.kapwing.com/pricing) ·
[VEED](https://www.veed.io/pricing) — 모두 2026-08-13 확인.

주목할 두 가지. **Kapwing 무료 티어의 "저장 3일"** 은 이 목록에서 가장 공격적인
제약이다 — 사흘 뒤에 프로젝트가 사라진다. 그리고 **Clipchamp 무료가 1080p
watermark 없이 무제한 export** 라는 사실은 브라우저 편집기의 무료 기준선이
생각보다 높다는 뜻이다. **framewright 가 "무료"만으로 차별화할 수는 없다.**

### 1-C. 사용자 규모 — 그리고 널리 인용되는 숫자들이 가짜인 이유

| 제품                | 수치                                                                                | 등급                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CapCut**          | Google Play **10억+ 설치** (2026-08-12 갱신)                                        | **measurement** (스토어 구간)                                                                                                                                                         |
| CapCut              | **월 모바일 활성 사용자 3억+**, 모바일 영상편집 활성 사용자의 **81%**               | **analyst estimate** (Sensor Tower → [Bloomberg](https://www.bloomberg.com/news/articles/2024-07-29/adobe-canva-losing-users-to-bytedance-s-capcut-especially-on-tiktok), 2024-07-29) |
| **Canva**           | **MAU 2억 6,500만**, 유료 **3,100만**, ARR **$40억**(2025년 말), 기업가치 $420억    | **vendor claim** (공동창업자 발언 → [TechCrunch](https://techcrunch.com/2026/02/18/canva-gets-to-4b-in-revenue-as-llm-referral-traffic-rises/), 2026-02-18)                           |
| Canva               | Google Play **5억+ 설치**                                                           | **measurement**                                                                                                                                                                       |
| **Kapwing**         | **크리에이터 3,500만**, 하루 10만+ 영상                                             | **vendor claim** (날짜 없음, [about](https://www.kapwing.com/about))                                                                                                                  |
| **VEED**            | "millions of marketers, founders, and creators" — 수치 없음                         | **vendor claim**                                                                                                                                                                      |
| **Adobe**           | Digital Media ARR **$192억**(2025-11-28), Creative ARR $138.5억(FY2024 마지막 공시) | **measurement** (10-K)                                                                                                                                                                |
| **Premiere Pro**    | 제품별 사용자 수 **공시하지 않음**                                                  | —                                                                                                                                                                                     |
| **Final Cut Pro**   | **찾지 못함** — Apple 은 한 번도 공개한 적 없음                                     | —                                                                                                                                                                                     |
| **DaVinci Resolve** | **찾지 못함** — 유일한 벤더 언급이 2016년의 "millions of editors"(수치 없음)        | —                                                                                                                                                                                     |
| **Clipchamp**       | **찾지 못함** — Windows 11 번들 이후 어떤 사용량 수치도 없음                        | —                                                                                                                                                                                     |
| **iMovie**          | **찾지 못함**                                                                       | —                                                                                                                                                                                     |

**세 프로 NLE 에 대해 돌아다니는 "X백만 사용자" 수치는 전부 출처가 없다.**
Adobe 의 FY2025 10-K 를 텍스트로 변환해 grep 한 결과 "Premiere" 는 5회 나오지만
전부 서술적 문장이고 `million users` / `number of users` 는 **0회**다. 흔히
인용되는 "Premiere Pro 약 3,000만 사용자"는 Adobe 의 어떤 공시·보도자료에도
없으며 SEO listicle 들이 서로를 인용한 결과다 — **쓰지 말 것.** Blackmagic 의
보도자료 269건 중 최근 60건을 전문 검색한 결과, 사용자 수 언급은 2016년 두
건("millions of editors")뿐이었다.

기업 침투율의 대리 지표로는 Enlyft 의 technographic 추정이 있다 —
"Audio & Video Editing" 카테고리 25만 7,943개 기업 기준 Premiere Pro **29%**
(76,049사), Final Cut Pro **19%**(51,034사)
([Enlyft](https://enlyft.com/tech/audio-video-editing)). **세 가지 주의**:
(1) 좌석 수가 아니라 **회사 수**다 — 1만석 방송사와 2인 스튜디오가 각각 1이다.
(2) **DaVinci Resolve 의 4.05% 는 다른 카테고리**("Video Production &
Publishing")의 값이라 **같은 축에 그리면 안 된다.**
(3) 소비자 MAU(CapCut 3억, Canva 2.65억)와 기업 탐지 수(Premiere 76,049사)는
애초에 다른 것을 재는 숫자라 비율로 비교할 수 없다.

### 1-D. ★ 리뷰 수가 많은 것과 적은 것은, 각각 다른 이유로 그렇다

이게 이 표에서 제일 잘못 읽히기 쉬운 부분이다. **리뷰 수는 인기가 아니고,
리뷰가 적은 것은 무명이 아니다.** 최소 네 가지 메커니즘이 섞여 있고, 분리하지
않으면 엉뚱한 교훈을 얻는다.

1. **모바일 배포 대 데스크톱 설치.** 폰 앱은 스토어가 리뷰를 _구조적으로_
   수집한다. 설치형 데스크톱 NLE 는 평생 한 번도 리뷰 프롬프트를 만나지
   않는다. CapCut 이 Play 에서 1,284만 개, Premiere Pro 가 Capterra 에서 573
   개인 것은 **인기 차이가 아니라 유통 채널 차이가 대부분이다.** Premiere 의
   불만은 리뷰가 아니라 Adobe 포럼 스레드로 나타난다 — 그리고 실제로 이 조사의
   가장 강한 인용문은 전부 거기서 나왔다.

2. **B2B 리뷰 사이트는 표본이 작고 성격이 다르다.** Capterra 의 Premiere Pro
   573건은 "구매 검토용"으로 쓰인 리뷰다. 그래서 1–2★ 꼬리가 0.7% 로 거의
   없다 — 화난 개인 사용자는 Capterra 에 오지 않는다. **프로 데스크톱 도구의
   낮은 1★ 비율을 "제품이 안정적이다"로 읽으면 안 된다.** 같은 제품이 자사
   포럼에서는 "3주치 작업이 파괴됐다"는 제목을 달고 있다.

3. **무료 대량 배포는 1★ 꼬리를 만든다.** CapCut 은 Play 에서 32.4%,
   Premiere Rush 는 43.9% 가 1–2★ 다. 진입 장벽이 0 이면 기대와 맞지 않는
   사용자가 대량으로 들어오고, 그들이 별점을 남긴다. 유료 장벽은 그 자체로
   리뷰 필터다.

4. **플랫폼이 답을 결정한다.** 같은 CapCut 이 Microsoft Store 4.8, App Store
   4.61, Play **3.56**, Trustpilot **1.2** 다. VEED 는 Trustpilot 4.2 / 3,800건
   대 Capterra 3.2 / 62건 — 여기서 옳은 해석은 "Capterra 의 62건이 소표본
   이상치"이지, "Trustpilot 이 진실을 숨겼다"가 아니다. **단일 출처로 이
   제품들을 평가하는 주장은 거의 무의미하다.**

한 가지 예외적으로 믿을 만한 수치: **Clipchamp 의 Trustpilot 4.7 / 6,471건.**
모든 리뷰에 "Unprompted review" 라벨이 붙어 있고 페이지 자체가 "이 회사는 최근
리뷰를 요청하지 않았다"고 표기한다. 즉 초대 리뷰 부풀리기가 없다. 그리고
Clipchamp 은 **모든 플랫폼에서 일관된 유일한 제품**이다 (Trustpilot 4.7 / MS
Store 4.7 / Capterra 4.3 / G2 4.1). 브라우저 편집기가 좋은 평판을 받는 것이
가능하다는 증거로 이건 진짜다.

반대로 **Adobe 와 Microsoft 의 전사 Trustpilot 1.2 는 제품 평가가 아니다** —
상위 언급어가 Cancellation, Subscription, Payment 다. 결제·해지 불만이 회사
계정으로 몰린 것이다. 반면 **Blackmagic 의 2.6 은 제품 불만이 끌어내린 유일한
낮은 점수**라 오히려 더 의미 있다.

---

## 2. 반복되는 불만 — 그룹별

각 항목은 (a) 실제 발언 · (b) 반복도 · (c) 출처 · **판정** 순이다.
판정은 세 가지다: **고칠 수 있다** / **브라우저라서 더 나쁘다** / **본질적이다**.

### G1. 작업물이 사라진다 — 그리고 autosave 가 배신한다

이 조사에서 가장 크고, 가장 감정이 실린 덩어리다. "brutal", "absurd",
"unforgivable", "starting from scratch" 같은 단어는 전부 여기서 나온다.

**(a)**

> "Premiere Pro crashed without warning. And not only did it crash, it corrupted
> the project file in the process." — Carlos28699229h2l3, 2025-07-15. 제목은
> **"Three weeks of work destroyed by Premiere Pro. This is unforgivable."**

> "This has happened to me on a number of projects lately. I am wondering if
> it's a Premiere Pro 2025 bug?" — molly_4005, 2025-09-05.
> **모든 autosave 버전도 같은 오류로 열리지 않았다.**

> **"Do not rely on autosaves, Autosave in Premiere Pro has never been
> reliable."** — Peru Bob (Adobe Community Expert), 2018-08-31

> "Now I can't open the project - it crashes every time!" … "I looked for backup
> versions from the project load open screen, but there are none." …
> "Never mind - I've gone ahead and started redoing the project from scratch."
> — foxcorner (DaVinci Resolve), 2024-07-04

> "I've spent hours building an iMovie project… It crashed with the spinning
> symbol, so I force quit. When I re-opened it, everything had gone, except for
> the very first thing I'd put down the day before." — helenandjonathan, 2021-07

> "I have this too. Thank god I don't have to go back and redo the THIRTY
> PROJECTS that were there. This is **APPALLING**." — Barry Seymour (Clipchamp),
> 2026-01-23

**(b)** 압도적. Premiere 4+ 스레드/6+ 사용자(2025), Resolve **8+ BMD 스레드 +
10+ Reddit 스레드**, iMovie 5 스레드(한 곳은 15+ 명), Clipchamp **5 스레드 /
8+ 사용자**(2025-12 ~ 2026-02).

**(c)**

- https://community.adobe.com/bug-reports-728/three-weeks-of-work-destroyed-by-premiere-pro-this-is-unforgivable-1331842
- https://community.adobe.com/t5/premiere-pro-bugs/premiere-pro-2025-project-file-corrupted-amp-autosaves-also-won-t-open/idc-p/15492229
- https://community.adobe.com/t5/premiere-pro-discussions/auto-saves-didn-t-auto-save/td-p/10040800
- https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=204350
- https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=171925 ("Autosave saved over 80% of my work")
- https://discussions.apple.com/thread/255895576
- https://learn.microsoft.com/en-us/answers/questions/5676447/clipchamp-lost-projects-due-to-update

**판정: 대체로 고칠 수 있다. 단, 지금 구조로는 절반만 고쳐져 있다.**

이 덩어리의 진짜 교훈은 "autosave 를 하라"가 아니다. 그건 다들 하고 있었다.
교훈은 **autosave 가 깨진 상태를 성한 상태 위에 덮어썼다**는 것이다. Premiere
사용자가 발견한 회전(rotation) 문제가 특히 날카롭다 — autosave 개수가 적으면
"손상 이후"의 스냅샷이 몇 시간 만에 성한 스냅샷을 전부 밀어낸다.

framewright 의 대응은 이미 부분적으로 옳다: `pruneVersions` 는 자동 스냅샷을
먼저 버리고 **이름 붙은 manual 버전은 최대 20개까지 따로 지킨다**
(`src/engine/persistence.ts`). "이름을 붙였다 = 이 상태가 살아남기를 원했다"는
해석은 정확히 이 실패를 겨냥한 설계다. `deserialize` 가 손상된 문서를 거르는
것도 같은 방향이다.

**그런데 자동 스냅샷 10개는 여전히 같은 함정에 노출돼 있다.** 사용자가 한 번도
이름을 안 붙였다면 회전 논리는 Premiere 와 동일하다. 그리고 더 큰 문제는 G-B1
(아래)이다 — 애초에 localStorage 자체가 지워질 수 있다.

### G2. export 가 timeline 과 다르다 ★

framewright 아키텍처와 가장 직접적으로 맞물리는 그룹이다.

**(a)**

> "randomly audio parts are missing… It makes the entire product unusable"
> — Christian277601085p2a, 2025-04-23 (Premiere)

> "the export doesn't match the look on the timeline. Exposure and colours are
> completely different from the original." — jaymie_9592, 2024-12-16

> "The miniplayer to show progress shows segments of the video that I edited out
> and already deleted. What once was a smooth video turns into a slide show that
> changes images once may every minute. This issue carries over into the actual
> downloaded mp4 file as well, **rendering it useless.**" — Clipchamp,
> 2024-02-18

> "It looked perfectly fine in the editor, with captions and effects, but now it
> split and it is extremely slow" — Clipchamp, 2024-11-05

> "I export MP4 at 1080, 10 megs bit rate, double pass and the video levels are
> still higher than what I see in timeline playback." — Eric Merklein (Premiere)

**(b)** 매우 높음. Premiere 는 **단일 스레드에 10명**(2025-02 ~ 2026-08) + 별도
"export ≠ timeline" 스레드 5개 이상. Clipchamp 은 **3명이 독립적으로 확인**,
스레드는 **해결 없이 잠겼다**. Canva Video Editor 2.0 에서도 같은 계열(잘라낸
클립이 export 에 되살아남).

**(c)**

- https://community.adobe.com/questions-729/fix-the-bug-of-audio-missing-from-export-1408478
- https://community.adobe.com/questions-729/export-doesn-t-match-timeline-1416834
- https://learn.microsoft.com/en-us/answers/questions/5274063/clipchamp-broken-video-when-attempting-to-export
- https://creativecow.net/forums/thread/exports-dont-match-premiere-pro-video-look-in-time/
- https://soloshannon.substack.com/p/canva-is-broken-and-i-almost-lost

**판정: 고칠 수 있다. 그리고 이게 framewright 가 실제로 이길 수 있는 신뢰다.**

framewright 의 golden rule 7("no wall-clock in engine timing — 재생과 export 가
같은 master clock / frame index 에서 위치를 유도한다")과 ADR-0002 가 정확히 이
실패를 구조적으로 막는다. ADR-0008 의 경위가 이 원칙이 작동한다는 증거다:
소스가 2프레임 일렀을 때도 **preview 와 export 는 서로 일치했다** — 틀린 것은
frame→media 매핑이었지 둘의 불일치가 아니었다.

한 가지 구체적 회귀 테스트 후보가 나왔다. Clipchamp 의 export 크래시는
**재현 트리거가 특정됐다: 배속(speed-up)이 걸린 클립**, 해상도와 무관, 크래시
지점이 배속 시작 프레임과 정확히 일치. 두 사용자가 독립적으로 좁혔다
(https://learn.microsoft.com/en-us/answers/questions/5274063/...). framewright
가 언젠가 속도 변경을 넣는다면, 그 순간이 규칙 7 이 시험받는 지점이다.

**아직 못 한 것**: `CLAUDE.md` tech debt 의 "golden-file byte comparison for
export output" 은 gold-plating 이 아니다. 위 인용들이 말하는 실패는 전부
"프레임 수와 duration 은 맞는데 내용이 다르다" 계열이고, 현재 e2e 는 프레임
수와 duration 만 본다.

### G3. 실패했는데 왜 실패했는지 말하지 않는다 ★

G1·G2 와 별개로 세어야 할 만큼 자주 나온다. 그리고 **고치기 가장 싸다.**

**(a)**

> "The share operation [...] has failed" … **"why doesn't it tell me WHY it has
> failed?"** — FilipOfficial (Final Cut Pro), 2025-09-30.
> 원인(특정 compound clip 의 플러그인 하나)을 찾는 데 **11일** 걸렸다.

> Adobe 자체 FAQ: _"the most common error code is 'Error Code 3, Unknown
> Error'"_ — 대표 실패 모드의 이름이 문자 그대로 "Unknown" 이다. (조회수 34,966)

> "Clips will appear as 'Media off-line' when loaded into Resolve.
> **This is an incorrect error statement.**" — theatreofnoise, 2024-11.
> 진짜 원인은 무료판의 HEVC 코덱 미지원인데, 화면에는 "미디어 없음"이라고 뜬다.

> "I tried to export it at 720p, but when it got to around a third of the way
> there, it stopped." — ThatOneWindowsFan (iMovie), 2024-10.
> 커뮤니티 진단: _"There may be a corrupt clip or frame at the 1/3 point… Look
> for black frames, white flashes, artifacts."_ — **앱은 어느 클립인지 못
> 말하고, 사용자가 눈으로 찾아야 한다.**

> "it says an error has occured and to try again... but no matter how many times
> I do it, it fails!" — Adobe Express 사용자. 진짜 원인은 **폰트 하나**였다.

> "Some videos and audio will fail to import without explanation" — Capterra,
> DaVinci Resolve

**(b)** 매우 높음. FCP 5+ 스레드 + 전용 지원 문서, Premiere 5+ 스레드,
Resolve **BMD 7개 스레드**(한 번의 검색에서만), iMovie 6 스레드(2020→2025),
Adobe Express 4+ 사용자.

**(c)**

- https://discussions.apple.com/thread/256152206
- https://community.adobe.com/t5/premiere-pro-discussions/faq-fix-error-compiling-movie-errors-in-premiere-pro/m-p/12757295
- https://www.theatreofnoise.com/2024/11/codec-limitations-of-davinci-resolve.html
- https://discussions.apple.com/thread/255816151
- https://community.adobe.com/bug-reports-328/adobe-express-failing-to-export-videos-animations-1468797
- https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=205830

**판정: 고칠 수 있다. framewright 는 이미 절반 이상 하고 있다.**

Resolve 커뮤니티의 표준 조언이 이 그룹의 성격을 요약한다: `Preferences > User >
UI Settings > Stop renders when a frame or clip cannot be processed` **를
끄라**는 것. 즉 "실패하지 말고 조용히 손상된 파일을 뱉어라". framewright 는
정반대를 하고 있다 — `ExportButton` 은 미디어가 없으면 **아예 시작을 거부하고**
(`영상 파일을 다시 선택한 뒤 내보낼 수 있어요`), 끝난 뒤에는
`⚠ N프레임은 원본을 읽지 못해 검은 화면으로 채웠어요` 로 **몇 프레임이
검었는지 숫자로 말한다.** RUNBOOK 의 "Speak plainly" 규칙이 이 그룹 전체에
대한 답이다.

남은 격차는 하나다: **어느 클립에서 실패했는지**를 말하는 것. 현재는 프레임
개수만 나온다. 이건 값싼 개선이고, 위 인용 전부가 그걸 요구한다.

### G4. 성능 — 랙, 드롭 프레임, "내 컴퓨터에서 안 돌아간다"

**(a)**

> "Just updated to Premiere Pro 25.3 and getting severe lag during playback and
> timeline scrubbing, **even at 1/4 resolution**." — FOediting, 2025-06-22

> "The playback issue occurs even on a powerful machine" — jon_4308, 2025-07-20
> (RTX 4080 에서 **1080p30** 편집 중)

> "it really genuinely does get worse every year… it still runs like ****"
> — Sterphy, 2025-08-14

> "Incredibly laggy playback, **even with proxies, render cache**…"
> — r/davinciresolve 스레드 제목 `[스니펫]`

> "It will crash because of out of memory, even if on 1080p, when scrubbing
> timelines or rendering. The highest i can make to work is 720p"
> — DaVinci Resolve for iPad, App Store 리뷰

> "this site makes my whole Chromebook freeze" — anaya malik (Kapwing)

**(b)** 매우 높음. Premiere 6+ 스레드/8+ 사용자(2023–2026), Resolve **8+
스레드 + 서브레딧이 아예 `playback_lag` 위키 페이지를 운영**(개별 응답을
포기했다는 뜻), 브라우저 편집기 3 출처.

**(c)**

- https://community.adobe.com/t5/premiere-pro-bugs/anyone-else-getting-playback-lag-in-premiere-pro-25-3/idi-p/15383255
- https://community.adobe.com/questions-729/premiere-pro-2025-is-a-mess-stop-pushing-broken-features-1418031
- https://www.reddit.com/r/davinciresolve/wiki/playback_lag/ `[스니펫]`
- https://apps.apple.com/us/app/1581363826?see-all=reviews&platform=ipad
- https://community.adobe.com/t5/adobe-express-bugs/express-video-editor-is-incredibly-glitchy-slow-and-lagging-tonight/idi-p/15534816

**판정: 부분적으로 본질적. 브라우저라서 더 나쁘다.**

정직하게 적는다. WebCodecs 는 하드웨어 디코드를 쓰지만 framewright 는
`CLAUDE.md` tech debt 가 인정하듯 **컷마다 디코더를 새로 띄운다**(클립당 새
`PlaybackSession`). proxy media 도, frame cache 도, warm decoder 도 아직 없다.
1080p 짧은 클립이라는 ADR-0001 의 전제 안에서는 버티지만, 그 전제를 벗어나면
Resolve 사용자가 "proxy 를 켜도 랙이 걸린다"고 말하는 지점에 훨씬 빨리 도달할
것이다.

**상쇄 요인이 하나 있고, 그건 진짜다**: 위 인용의 상당수는 "고사양 PC 인데도
느리다"이다. 데스크톱 NLE 의 성능 문제는 하드웨어 부족이 아니라 소프트웨어
비대화에서 온다. 작고 단일 목적인 편집기는 여기서 구조적으로 유리하다.

### G5. 미디어를 잃어버린다 — relink 지옥

**(a)**

> "This is a major issue since the V20 release. The files are still showing
> missing even when I browse to the right folder." … **"The only solution that
> works is to manually reimport and conform each clip. Doing that on a
> feature-length doc with hundreds of clips is brutal and insanely
> time-consuming."** — lassoueda (Resolve), 2025-11-11

> "Relinking of footage is painful as it takes 1-20 minutes."
> — Calgary_VideoAudioTech (Premiere), 2025-08-11

> "In my first attempt I only transferred the old library and ended up with many
> missing links to the original files." — sab2624 (iMovie), 2025-04

> "It takes anywhere from 30 minutes to 1 hour to upload ONE video clip… Once it
> is finished uploading, it disappears from the 'My Media' list"
> — Conner S., 1★ Capterra (Clipchamp), 2023-03-31

**(b)** 매우 높음. Resolve **8 BMD 스레드**, Premiere 다수, iMovie 7 스레드 +
10 Reddit 스레드, Clipchamp 2 스레드.

**(c)**

- https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=223103
- https://community.adobe.com/bug-reports-728/premiere-pro-2025-is-taking-forever-relinking-media-every-time-its-opened-1331906
- https://discussions.apple.com/thread/256040717
- https://learn.microsoft.com/en-us/answers/questions/5777490/clipchamp-assets-get-unloaded-even-after-relocatio

**판정: framewright 는 지금 이 문제를 _가지고 있다_. 그리고 고칠 수 있다.**

이게 이 조사에서 코드와 가장 아프게 맞물리는 지점이다. `src/engine/types.ts`
의 `opfsKey` 는 `// local cache key (future)` 라고 적혀 있고, **아직
구현되지 않았다** — `grep` 상 `navigator.storage.getDirectory` 호출은 레포
어디에도 없다. `src/engine/storage.ts` 주석이 정직하게 말한다: _"Only the small
JSON document is stored — media stays out of it."_

결과: **새로고침할 때마다 사용자가 원본 파일을 다시 고른다.** `MediaBin.tsx` 의
`이전 작업을 열었어요. 아래 영상을 다시 선택하면 그대로 이어서 편집할 수
있어요` 가 그 UI 다.

정직하게 평가하면 — **이건 현재 잘 처리된 나쁜 상황이다.** 문구는 평이하고,
어떤 파일이 필요한지 이름으로 나열하고, export 는 미디어 없이 시작하지 않으며,
`⚠ / 다시 선택 필요` 로 상태를 표시한다. Resolve 가 "Media Offline" 이라고
거짓말하는 것보다 훨씬 낫다. 하지만 **위 인용들이 요구하는 것은 좋은 relink UI
가 아니라 relink 가 필요 없는 것이다.**

### G6. UI 가 압도한다 — 그리고 초보자는 CapCut 으로 간다

**(a)**

> "When I opened Premiere Pro for the very first time, a tutorial started... I
> was totally overwhelmed. Not a good beginning in my journey to learn Premiere
> Pro." — 2025-10-24. 전문가 답변은 **되레 못을 박는다**: _"this is a pro level
> application... it does require a rather steep learning curve."_

> **"This is lowkey highly overwhelming."** — r/davinciresolve 스레드 제목
> `[스니펫]`

> **"Why is cut page so confusing"** / **"Cut vs. Edit page ? still
> confused..."** / **"I'm stuck on Color mode, How do i get back on Edit
> mode?"** — Resolve 스레드 제목들 `[스니펫]`

> "I have to spend hours to learn Resolve what maybe can done in minutes in
> capcut." `[스니펫]`

> "I see why the social media standard is CapCut as it simply makes sense."
> `[스니펫]`

> "It isn't easy to use, and the user interface is hard to learn"
> — Capterra, Resolve · "very hard to use… **sort of anti new user**"
> — App Store, Resolve for iPad

> "I gave up trying to create a simple video after a number of failed attempts."
> — 1★ Trustpilot, Canva, 2026-08-10 (제목: **"Too complicated"**)

**(b)** 높음. Resolve **6+ 스레드(3개 서브레딧)** + Capterra + App Store,
이탈 관련 **8+ 스레드**(r/NewTubers, r/VideoEditing, r/editing).

**(c)**

- https://community.adobe.com/t5/premiere-pro-discussions/tutorial-withing-premiere-pro-is-overwhelming-for-new-user/td-p/15562363
- https://www.reddit.com/r/davinciresolve/comments/1bv94w6/this_is_lowkey_highly_overwhelming/ `[스니펫]`
- https://www.reddit.com/r/davinciresolve/comments/18qtugl/i_intimidated_myself_with_davinci_and_want_to/ `[스니펫]`
- https://www.reddit.com/r/editing/comments/1b77w0l/davinci_resolve_free_capcut_or_shotcut_which_free/ `[스니펫]`
- https://www.capterra.com/p/209733/DaVinci-Resolve/reviews/

**판정: framewright 의 존재 이유. 다만 증거의 성격을 정직하게 볼 것.**

Resolve 의 page 모델(Cut/Edit/Fusion/Color/Fairlight)에 대한 옹호 논리가
드러내는 게 있다: _"A Pro-tools sound guy… can go to the Fairlight page and
directly apply all of his skills"_ — **페이지는 직업별로 조직돼 있지, 초보자가
하려는 일 기준으로 조직돼 있지 않다.** `docs/UX.md` 의 "progressive disclosure"
와 "one obvious way to do the common thing" 이 정확히 반대 방향이다.

초보자가 CapCut 을 고르는 이유의 가장 정확한 진술은 **G13** 에 있다 —
_"it's just called what you think it is"_. 이 조사에서 `docs/UX.md` 의
"familiar words, not internal jargon" 에 대한 가장 강한 외부 증거다.

**증거의 한계도 적는다.** "그냥 영상 하나 자르고 싶은데 왜 이렇게 어렵냐"는
말은 잘 안 나온다 — 그렇게 느끼는 사람은 글을 쓰지 않고 떠나기 때문이다.
이 그룹의 증거는 *스레드 제목*과 *이탈 후 회고*가 대부분이고, 그건 신호이지
인용문이 아니다.

### G7. 단축키가 사라진다

**(a)**

> "When I upgraded to PP 25.0 I lost all keyboard shortcut functionality."
> — Robert36028542o70p, 2024-11-01

> "Keyboard shortcuts are empty in 25.1" — christian_2958, 2025-01-19
> (캐시 삭제로 고쳤지만 **재시작하면 되돌아갔다**)

> "Final Cut Pro is not saving my custom keyboard shortcuts when I close the
> program" … "every time I reopen Final Cut Pro, that shortcut gets replaced by
> 'Go to Previous Subframe'" — ninose

> Cyrillic 키보드 레이아웃에서는 바인딩의 **약 절반이 사라지고**, 설정 UI 는
> 충돌을 표시하지 않는다. 별도 스레드는 F5/F6 가 **이미 존재하지 않는 명령에**
> 묶인 채 보이지 않게 남아 있음을 지적한다.

**(b)** 높음. 두 앱 합쳐 6+ 스레드(2023–2025).

**(c)**

- https://community.adobe.com/t5/premiere-pro-discussions/premiere-pro-keyboard-shortcuts-are-gone-when-upgraded-to-25-0/m-p/14956602
- https://discussions.apple.com/thread/254388961
- https://community.adobe.com/t5/premiere-pro-bugs/shortcuts-not-working-and-having-strange-assignments/idc-p/14849765

**판정: framewright 는 이 버그를 _두 개_ 이미 재현할 준비가 돼 있다.**

ADR-0007 은 keymap 을 데이터로 만들었고 충돌을 조용히 해결하지 않고 보고한다 —
좋다. 그런데 `CLAUDE.md` tech debt 의 두 항목이 **위 인용과 같은 버그다**:

1. _"The keymap has no presets and no import/export — per-browser
   `localStorage` only, so a new machine starts from defaults."_
   → 브라우저 프로필 하나만 바뀌면 Premiere 의 "업그레이드하니 단축키가 전부
   사라졌다"와 사용자 체감이 **동일하다.**
2. _"A keymap override for an action id that no longer exists is ignored but
   never cleaned out of `localStorage`, and nothing reports it."_
   → **이건 Premiere 의 F5/F6 유령 바인딩 버그 그 자체다.**

부수적으로 좋은 소식: 한 Premiere 베테랑이 Resolve 로 옮기며 "없으면 못 살
바인딩"으로 꼽은 게 **Q/W (trim to playhead)** 였다
(https://www.versluis.com/2026/01/switching-to-davinci-resolve-with-a-premiere-pro-mindset/).
framewright 는 이미 `q`/`w` 를 그렇게 쓰고 있고(`commands.ts`), `c` = split,
`delete` = ripple delete 도 Premiere 관례다. **Premiere 프리셋은 새로 설계할
게 아니라 이름만 붙이면 되는 상태에 가깝다.**

### G8. 구독 · 약관 · 내 콘텐츠의 소유권

**(a)**

> **"I stopped being a customer and became a captive."** … "I hate that I need
> them. I hate that Adobe knows it. And I hate that there's no easy way out."
> — Yadullah Abidi, 2025-10-17

> "you can never open 2024 projects ever again and this is unacceptable"
> — Joseph Smiles, 2024-10-25 (Premiere 버전 잠금)

> "Enough with the subscriptions already… This simply serves to dilute the Apple
> brand" — Dj64Mk7, 2026-01-14 (Apple Creator Studio $12.99/월)

> **"STOP MAKING EVERYTHING PRO!"** … "I will not pay 100 dollars just to have
> one feature I used to be able to have" — Pizza4U&Me, App Store (CapCut),
> 2024-09-03

CapCut 은 2025-06-12 발효 약관에서 사용자 콘텐츠에 대해 광범위한 라이선스를
가져갔다. **약관 원문**(2026-04-15 최종 갱신) 확인:

> "you grant to the Company and its affiliates a non-exclusive, royalty-free,
> transferable, sub-licensable, **perpetual and worldwide licence** to use your
> User Content" — https://www.capcut.com/clause/terms-of-service

사용자 반응:

> "These Terms of Service updates make the platform basically unusable unless
> you… don't mind your own original content being stolen and used for free."
> — Reddit, 2025-06

> "Wait what? You can be held liable if CapCut uses the videos you edit????"
> — 전부 대문자로 된 면책(indemnity) 조항에 대한 반응

**두 가지를 정직하게 붙인다 — 널리 퍼진 서술 중 확인되지 않은 부분이 있다.**

1. **약관 원문에 "AI 학습" 조항은 없었다.** "내 얼굴로 AI 를 학습시킨다"는
   공포는 사용자 추론이고, 상당 부분이 챗봇 요약을 거쳐 퍼졌다. 공포는
   실재하고 광범위하지만 **사실로 반복하면 안 된다.**
2. **라이선스 범위는 "제출/업로드된" 콘텐츠다.** Larry Jordan 의 정리:
   _"This transfer of rights to CapCut only occurs when you upload your video to
   CapCut's servers."_
   (https://larryjordan.com/articles/caution-capcut-changed-their-license-and-may-own-your-content/)
   즉 "초안에도 적용된다"는 서술은 법률 블로그의 해석이지 조항 인용이 아니다.

**그런데 이 두 번째 사실이 오히려 요점이다** — 사용자들은 **자기 자료 중 무엇이
"업로드된" 것인지 구분할 수 없었다.** 클라우드 동기화가 자동인 편집기에서
그 경계는 사용자에게 보이지 않는다. framewright 처럼 업로드가 아예 없는
구조는 그 질문 자체를 없앤다.

Adobe 도 2024년 같은 계열의 반발을 겪었다 ("Your content is yours and will never
be used to train any generative AI tool" 로 수습).

**(b)** 높음. Premiere/FCP 5+ 스레드·기사, CapCut 은 법률 사무소 해설을 포함해
다수 보도.

**(c)**

- https://www.makeuseof.com/adobe-has-me-locked-down-i-hate-it/
- https://community.adobe.com/feature-requests-730/2024-is-no-longer-compatible-with-2025-upgrade-in-premiere-pro-1327915
- https://forums.macrumors.com/threads/apples-creator-studio-app-bundle-now-available-for-12-99-per-month.2476777/
- https://www.isabokelaw.com/blog/capcuts-new-terms-of-service-what-every-content-creator-needs-to-know
- https://www.techloy.com/capcuts-latest-terms-of-service-raises-big-questions-about-content-ownership/
- https://www.engadget.com/adobe-is-updating-its-terms-of-service-following-a-backlash-over-recent-changes-120044152.html

**판정: framewright 의 구조적 우위. 아직 아무도 그걸 말해주지 않고 있을 뿐.**

framewright 는 미디어를 서버에 올리지 않는다 — 올릴 서버가 없다. export 는
`exportProject` 가 로컬 WebCodecs 로 돌리고 `URL.createObjectURL` 로 내려준다.
watermark 도 없고 요금제도 없다. **CapCut 약관 반발과 Adobe 2024 반발의 정확한
반대편에 서 있다.** 이건 기능이 아니라 포지셔닝이고, 지금은 어디에도 적혀
있지 않다.

한 가지 정직한 단서: 이 조사에서 **개인 사용자의 "프라이버시" 불만 원문은 못
찾았다.** 프라이버시를 근거로 화내는 글은 대부분 경쟁 제품의 마케팅이었고
그건 증거로 안 쓴다. 다만 Descript 의 사례는 진짜다 — "원본을 클라우드에
올리지 말게 해달라"는 5년 된 요청이 2025-12 에 _"We've since moved to full
cloud-based file storage so this is not something that will be considered any
time soon"_ 로 **거절 종결**됐다
(https://feedback.descript.com/feature-requests/p/option-to-not-upload-original-file-to-the-cloud).
수요는 있고 업계는 반대 방향으로 갔다.

### G9. 정밀도가 없다 — 그리고 아무도 기대하지 않게 됐다 ★

**(a)**

> "I want it cut where the blue line is. But it wont allow me to cut it there.
> It only allows at spacing of 1 second." — Premiere 사용자, 2018-07-06

> "randomly clicking all over the clip in the hopes that I'll land on the time
> stamp that I'm looking for is really inefficient." — GenevieveW8 (iMovie),
> 2020-11

> "I cannot seem to figure out how to move the audio clip in small enough
> increments to align with the video… It sort of snaps only to two places and
> never in between" — Realimaginal (iMovie), 2019-02

> "There is no option to display time a certain way, nor frames." — iMovie.
> 온라인 가이드가 아직도 안내하는 `Display time as HH:MM:SS:Frames` 설정은
> **iMovie 10 에서 사라졌다.**

> "They Don't even have dedicated precision tools so you basically have to
> eyeball everything" — 1★ App Store 리뷰

그리고 **이 조사 전체에서 가장 시사적인 한 줄** — Clipchamp 에서 프레임 단위로
움직이는 법을 묻자, Microsoft 직원이 직접 답한다:

> "You can use X+← and X+→ to slowly move the entire video track. Of course,
> **after repeated verification, this does not seem to be frame-by-frame
> movement**, but the movement is small, and **it will adapt based on how you
> zoom in or out** of the video track… achieving a frame-by-frame _effect_ when
> the timeline is more detailed." — Ian - MSFT, 2025-01-09

**질문자는 그걸 받아들였다.** nudge 단위가 프레임이 아니라 zoom 배율의 함수라는
답을 듣고 수긍한 것이다.

**(b)** 중간. Premiere/FCP 4 스레드, iMovie 2 스레드 + 8 제목, Clipchamp 1
스레드. **최신성은 약하다** — 가장 선명한 인용 두 개가 2018/2019 다.

**(c)**

- https://community.adobe.com/t5/premiere-pro-discussions/trimming-a-clip-with-more-precision/td-p/9954760
- https://discussions.apple.com/thread/252046696
- https://discussions.apple.com/thread/250147740
- https://learn.microsoft.com/en-us/answers/questions/5397006/how-can-you-move-frame-by-frame-in-clipchamp

**판정: framewright 의 이름 그 자체. 다만 이건 "요구"가 아니라 "공백"이다.**

정직하게 읽자. 사용자들은 frame accuracy 를 **요구하지 않는다.** 요구하지 않는
이유는 필요 없어서가 아니라, 브라우저 편집기에서 그걸 기대하지 않도록
길들여졌기 때문이다. Clipchamp 스레드가 그 길들임의 완결된 사례다.

이건 두 가지를 동시에 뜻한다. (1) 포지셔닝 기회가 진짜다 — 경쟁 제품이 벤더
입으로 "프레임 단위가 아니다"라고 인정한다. (2) **그 자체로는 마케팅이 안
된다** — 아무도 검색하지 않는 것을 파는 셈이다. frame accuracy 는 사용자가
느끼는 다른 것(정확히 여기서 잘렸다, 다시 열어도 같다, export 가 preview 와
같다)의 *원인*으로 말해야 하지, 그 자체를 셀링 포인트로 놓으면 안 된다.

### G10. magnetic timeline — ADR-0006 과 정면으로 맞물리는 항목

`docs/adr/0006` 은 "silently reflows clips the user did not touch" 하는 magnetic
mode 를 **거부**했다. 사용자들이 실제로 그걸 원하는가? 답은 갈리는데,
**갈리는 방식이 결정적이다.**

**반대 (a)**

> "What if I WANT dead space? **I don't want my editing program to fight me by
> assuming that it knows what I want.**" — Joshua Irwin, 2011-06-23

> "Trying to edit a music video now, and am about to go crazy with the magnetic
> timeline. Everytime I add a transition it moves all clips out of sync with the
> music!!" — syntax_r, 2011-06-23 · **"LEAVE MY GAPS ALONE APPLE!!!!"** — jpjd

> "I hate the way it makes the time-line jump allover the place. One is
> constantly asking. 'Now where did that go?'" — App Store 리뷰,
> **2024-08-05**, 50년 경력 자칭 프로

> "Please can someone help me to turn off every single piece of magnetism or
> stickiness… FCP keeps moving and grabbing things and won't let go"
> — Marketqwerty, **2025-07-20** (뮤직비디오, 파형 기준 싱크)

> "I became too frustrated by the shifting timeline issue and moved to another
> program" — Beatrice K., Capterra, **2026-04-30**

**찬성 (a)**

> "Edit a documentary in FCP. Then you will LOVE the magnetic timeline… when you
> 'get it' it is a thing of beauty." — T. Payton, 2012-06-04

> "When the client wants a change it seems totally set up for that… I used to
> dread changes, but with this TL it's so quick." — Tony West, 2012-06-05

> "Not when you know how it works!… when you do it becomes second nature."
> — Steve Connor, 2012-06-06

**(b)** 양측 합쳐 10+ 스레드/페이지. **정직한 한계: 양측 다 풍부한 자료는
2011–2014 Creative COW 다.** 2024–2026 확인 사례는 얇다(App Store 리뷰 1,
Apple 스레드 1, Capterra 2).

**(c)**

- https://creativecow.net/forums/thread/magnetic-timeline-is-a-joke-want-an-option-to-turn/
- https://creativecow.net/forums/thread/solution-to-the-inconvenient-magnetic-timeline/
- https://discussions.apple.com/thread/3131802
- https://discussions.apple.com/thread/256101765
- https://apps.apple.com/us/app/final-cut-pro/id424389933?mt=12&see-all=reviews&platform=mac
- https://fstoppers.com/video-editing/embrace-magnetic-timeline-final-cut-pro-x-515990

**판정: ADR-0006 을 유지한다. 그리고 세 가지 구체적 근거가 새로 생겼다.**

1. **모든 반대 사례는 "외부 타이밍 제약에 맞추던 사람"이다.** 음악에 싱크,
   파형에 정렬. 편집기가 알 수 없는 제약을 사용자가 들고 있을 때, 자동 도움은
   정확히 그 순간 방해가 된다. framewright 의 대상 사용자(병의원 교육·상담
   콘텐츠)가 음악 싱크를 자주 하진 않겠지만, **"내가 안 건드린 클립이
   움직였다"는 체감은 동일**하다.

2. **끌 수가 없다는 게 불만의 핵심이다.** FCP 의 답은 항상 Position 모드(`P`)
   이거나 구조적 우회(오디오를 primary storyline 에 깔기)다. 그리고 사용자가
   원하는 탈출구는 설정 토글이 아니라 **제스처 단위의 즉석 해제**(키를 누르고
   있는 동안)다.

3. **"magnetism" 과 "snapping" 을 아무도 구분하지 못한다 — 답변하는 전문가조차
   그렇다.** Marketqwerty 가 "모든 magnetism 을 끄고 싶다"고 묻자 채택된 답이
   _"if you mean, the snapping behaviour of clips in the timeline, you can turn
   snapping on or off… shortcut 'N'"_ 였고, 스레드는 그대로 해결 처리됐다.
   전혀 다른 두 기능이다.
   (https://discussions.apple.com/thread/256101765)

   **framewright 는 snapping 은 있고 magnetism 은 없다.** 이 구분을 UI 용어로
   명시적으로 지키는 것이 `docs/UX.md` 의 "familiar words, not internal jargon"
   보다 한 걸음 더 나간 요구다.

**단, 한 가지는 사용자 편이다.** Premiere 의 `close gap` 은 **다른 트랙에 클립이
있으면 조용히 동작하지 않는다** — "delete gap in timeline not working" 스레드가
그 얘기다 (https://community.adobe.com/t5/premiere-pro-discussions/gap-closing/td-p/14517888).
framewright 의 `timeline.closeGaps` 는 명시적 명령이고 트랙 조건에 좌우되지
않으므로 이미 더 낫다. **자동 reflow 를 거부한 것과, 요청했을 때 확실히
동작하는 것은 양립한다.** ADR-0006 은 그걸 이미 그렇게 적어 놨다.

#### ★ 반대 방향의 증거 하나 — 그리고 그게 ADR-0007 을 옹호한다

위 인용은 전부 **프로 또는 숙련자**의 것이다. 초보자 쪽 증거는 방향이 정반대인
게 하나 있고, 정직하게 실어야 한다. CapCut 을 쓰다 **iMovie 로 되돌아간**
사람의 글이다:

> "in iMovie, if I wanted to insert an audio/video clip, **it automatically
> shifted everything over**… In capcut… I have to manually shift everything over
> myself. **Edit: Switched back to iMovie and finished my video easily.**"
> (https://www.reddit.com/r/CapCut/comments/1ed1mzh/its_ridiculous_i_cant_insert_clips_without_manually_shifting/)

**이 사람은 자동 reflow 가 없어서 도구를 버렸다.** framewright 의 대상 사용자와
정확히 같은 층이다. 그냥 넘길 증거가 아니다.

그런데 자세히 읽으면 이건 ADR-0006 에 대한 반박이 **아니다.** 이 사람이 원한
것은 "내가 안 건드린 클립이 알아서 움직이는 모드"가 아니라 **"삽입하면 자리를
만들어 줄 것"** 이다. 둘은 다르다:

- ADR-0006 이 거부한 것: **암묵적·상시적** reflow — 아무 편집이나 하면 남들이
  따라 움직인다
- 이 사용자가 요구한 것: **명시적 명령 하나**(삽입)가 필요한 만큼만 공간을
  만드는 것

**그리고 framewright 는 이미 후자를 하고 있다.** ADR-0007 의 `clip.paste`
배치 규칙 3번: _"Otherwise later clips move right by exactly what the space
falls short — no more."_ 게다가 그 사실을 상태줄에서 말해 준다
("뒤 클립을 밀었어요"). ADR-0007 이 스스로 적어 둔 구분 — _"a push on an
explicit command, which is a different thing from the magnetic mode ADR-0006
rejected"_ — 이 이 사용자의 요구와 정확히 일치한다.

**따라서 판정은 유지하되, 조건이 하나 붙는다.** 이 사용자가 실제로 한 동작은
"클립을 가운데에 끼워 넣기"이고, framewright 에서 그건 **붙여넣기(`mod+v`)로만**
가능하다. `CLAUDE.md` tech debt 가 인정하듯 _"a paste always lands on the video
track, and the insert point snaps to a clip boundary rather than splitting."_
드래그로 클립을 옮길 때는 밀어내기가 없다. 즉 **같은 의도를 표현하는 경로가
하나뿐이고, 그게 제일 안 떠오르는 경로다.** 자동 reflow 를 켜는 게 아니라,
"여기에 끼워 넣기"라는 **명시적 명령**을 발견 가능하게 만드는 것이 이 증거에
대한 올바른 응답이다.

### G11. iMovie 형 반대 문제 — "너무 적어서" 벽에 부딪힌다

Resolve 가 압도한다면 iMovie 는 막아선다. framewright 가 "단순함"을 추구할 때
**어디까지 단순하면 안 되는지**의 지도다.

- **비디오 트랙 2개 상한.** _"Two video tracks is the max for video in iMovie."_
  우회는 export 후 재수입이고, _"was not impressed with the output quality"_.
  (https://discussions.apple.com/thread/253049078)
- **16:9 고정 — 세로 영상 불가.** _"the fact that I just discovered I can't
  export a portrait film from iMovie, is absolutely absurd, considering apple's
  bread and butter is the iPhone. **Like, how is this a thing?!**"_ (2020-11).
  2024-04 에도 _"iMovie 10 has a fixed 16:9 aspect ratio that cannot be
  changed."_ 최악의 사례: _"Spent a whole day filming in vertical… Spent a
  couple days editing everything in iMovie… only to have a weird aspect ratio
  with black space on both sides."_ — **이틀치 작업을 export 시점에 발견했다.**
  (https://discussions.apple.com/thread/252031289 ·
  https://discussions.apple.com/thread/255874660)
- **export 설정이 없어서 파일이 폭발한다.** 164MB 1시간 Zoom 녹화를 반으로
  잘라 export 하니 **860MB 초과**; "최저 품질"을 고르니 **더 큰 1.06GB** 가
  나왔다. 표준 조언은 "끝나고 HandBrake 로 다시 인코딩해라" — 패배 선언이다.
  (https://discussions.apple.com/thread/253001904)
- _"I have accomplished a lot with iMovie, but have now outgrown it."_
- _"Apple has been slowly dumbing down iMovie for years"_ — Kurt Lang,
  2024-08-25. 같은 스레드에서 원 질문자가 **몇 년 전에 되던 페이드를 못 하겠다**
  고 한다. (https://discussions.apple.com/thread/255732539)

**판정: framewright 에 대한 경고. E7–E9 백로그가 이미 대부분 답하고 있다.**

세로 영상(shorts reframe)은 **E8** 에 있다. 자막은 **E7** 에 있다. 하지만
16:9 사례의 교훈은 기능 유무가 아니라 **발견 시점**이다 — 사용자는 export 할
때 알았다. framewright 의 timeline 설정(`TimelineConfig`)이 프로젝트 시작
시점에 결정되고 preview 가 그대로 보여주는 구조라면 같은 함정은 없지만,
E8 에서 reframe 을 넣을 때 이 사례를 다시 읽어야 한다.

### G12. 접근성 — 아무도 안 하고 있다

> "no professional video editor on the market — Adobe Premiere, DaVinci Resolve,
> Final Cut — is actually usable with a screen reader."
> — 시각장애인 개발자, DEV Community.
> 격차가 너무 커서 **직접 새 앱을 만들기로 했다.**

**(b)** 낮음(1차 출처 1개 + Adobe 자체 accessibility conformance report). 개별
불만 스레드는 못 찾았다 — 그 사용자층은 애초에 이 도구들의 커뮤니티에 없다.

**(c)** https://dev.to/demirajvazi10max/reviving-ultra-creative-suite-the-first-fully-accessible-video-editor-for-blind-users-286l ·
https://helpx.adobe.com/premiere-pro/using/accessibility.html

**판정: 고칠 수 있고, 이미 상당 부분 하고 있다.**

framewright 는 `docs/UX.md` 와 ADR-0006 의 `.ruler`/`.track` 분리, `aria-disabled`
툴바, `tester-a11y` 페르소나로 이 영역에 이미 투자하고 있다. 시장 전체가 비어
있다는 사실은 그 투자가 낭비가 아니라는 뜻이다. **증거는 얇지만 방향은
명확하다.**

---

### G13. CapCut — 초보자가 실제로 쓰는 도구에서 실제로 일어나는 일 ★

이 문서에서 **증거 품질이 가장 높은 절**이다(Reddit RSS + Play 리뷰 RPC 원문).
그리고 framewright 의 대상 사용자와 가장 가까운 사람들의 목소리다.

#### 왜 초보자가 CapCut 을 고르는가 — 불만보다 이게 더 중요하다

가장 정확한 설명은 **떠나는 사람**이 썼다:

> "when you go to look for something **it's just called what you think it is**.
> To remove a background I just click the background removal button, I don't
> have to understand the nuance difference between chroma filters and whatever
> else. [In DaVinci] every single thing you need to watch like a 20 minute video
> to figure out how to do it. **They bury their damn features so deep in the
> UI.**"
> (https://www.reddit.com/r/CapCut/comments/1qmowww/pro_price_increase_is_the_death_of_capcut/)

나머지 이유들:

- **속도** — 프로의 평가라 더 무겁다: _"It's the quickest thing I've used yet,
  for fast commercial-paced work, like by a wide margin."_
- **원클릭 AI, 특히 자막** — _"There are not many apps that provide unlimited
  captions in multiple languages as CapCut does"_
- **폰만으로 완결되는 워크플로** — 월 $199–260 수익을 내는 사용자:
  _"i do everything on my phone. literally all of it."_
- **전환 비용이 해자다** — _"I've invested so much time with their in-house
  effects that if I change to Adobe, I'll have to basically start from
  scratch."_ **사람들은 싫어하면서도 남는다.**

`docs/UX.md` 의 "Familiar words, not internal jargon" 이 위 첫 인용과 정확히
같은 말이다. **이 조사에서 그 원칙에 대한 가장 강한 외부 증거다.**

#### 불만 — 압도적 1위는 paywall creep

> "I used to use CapCut exclusively but over the last year I've realized
> countless edits that used to be free are now limited use or pro only. The
> newest one? Basic captions" — 20+ 스레드(2024–2026) + Play 리뷰 ~15건

> "Why the hell extracting audio requires pro… It's a basic tool that is almost
> used in every video"

**export 자체가 유료화됐다** (~7 스레드, 2025-08 과 2026-08 두 차례 파동):

> "Been using it for 5 years and they got so fucking greedy that **I can't even
> export a video without signing up for pro**" (2026-08)

**그리고 구조적 불만은 "언제 알게 되는가"다** (8+ 스레드 + Play 5건):

> "been editing a big video for like a month… **I was careful not to use any pro
> features** yet now I can't export without a watermark" (2026-08-12)

> "they let you think that you can work on your video, **its not till the end**
> that they tell you that you have to pay for it" (Play 1★)

**작업물 소실** (~8 스레드 + Play 2건):

> "the last two days of editing just vanished and it's back to its original
> state… **i was about to export**" (2026-08-12)

> "AND THE FUCKING PROJECT JUST DELETES ITSELF… 'this material has been deleted'
> followed by an advert for me to purchase CapCut Premium. **I just lost HOURS
> OF WORK**"

**버전 업그레이드가 프로젝트를 인질로 잡는다** (~3 스레드):

> 커뮤니티 수리 스레드 제목: _"[FIX] This project was created by a newer version
> of CapCut. Update now."_ — 유료화를 피해 구버전으로 내려간 사람들이 **자기
> 프로젝트를 열지 못하게 됐다.** 해법은 `draft_content.json` 의 `app_version` 을
> 손으로 고치는 것이다.
> (https://www.reddit.com/r/CapCut/comments/1i97eih/fix_this_project_was_created_by_a_newer_version/)

**앱이 발밑에서 사라진다** (~6 스레드 + 보도):

- 2025-01-19 미국 금지 — 앱 내 공지: _"a U.S. law banning CapCut will take
  effect on January 19 and force us to make our service temporarily
  unavailable."_
- 2026-01-25 장애: _"Nothing will load it says everything needs pro"_ — 유료
  구독자들이 보상을 요구했다
- 2026-03-03: _"Spent an hour finishing up edits and can't export! CapCut is
  losing me as a subscriber."_

**계정과 인터넷이 필수다** — 로컬 편집기처럼 보이지만 아니다:

> "You also MUST log in with an account before you can do anything."
> "it needs a internet connection to work… if you randomly get an idea and have
> bad connection, you better hope you remember it" (Play 4★)

2024-08-05 부터 무료 클라우드 저장(1GB)이 폐지됐다
(https://techcrunch.com/2024/07/12/capcut-will-stop-offering-free-cloud-storage-from-august-5/).

**가격 인상과 해지 함정** (~9 스레드): _"$77/year to $179.99/year is an insane
price hike"_ (2026-06) · _"Their cancelation process is abhorrent."_

**약한 증거 하나**: paywall 이 사용자별로 A/B 테스트되는 것처럼 보인다는 관찰
(3개 출처뿐). 사실이라면 불만 스레드마다 "나는 안 그런데"라는 답글이 달리는
이유가 설명된다. **확정으로 쓰지 말 것.**

**출처:**
https://www.reddit.com/r/CapCut/comments/1icu76a/capcut_sucks_now/ ·
https://www.reddit.com/r/CapCut/comments/1vd9ihe/capcut_literally_made_exporting_videos_a_pro/ ·
https://www.reddit.com/r/CapCut/comments/1vmc7gs/im_tired/ ·
https://www.reddit.com/r/CapCut/comments/1haoe94/im_deleting_this_ass_app/ ·
https://www.reddit.com/r/CapCut/comments/1uekn4m/insane_price_hike/ ·
https://www.reddit.com/r/CapCut/comments/1qmep2i/capcut_down/

**판정: framewright 가 가진 것의 목록이 곧 CapCut 불만의 목록이다.**

요금제 없음, 계정 없음, 인터넷 없이 동작, 업로드 없음, watermark 없음,
`schemaVersion` 마이그레이션 러너(RUNBOOK 5절)로 버전 인질 방지. **문제는
그것들이 아무 데도 광고되지 않는다는 것뿐이다.**

단, 두 가지를 정직하게 붙인다. (1) 우리는 CapCut 이 잘하는 것 — 원클릭 자막,
효과 라이브러리, 템플릿 — 을 **하나도 갖고 있지 않다.** 사람들이 CapCut 에
남는 이유가 그것이다. (2) HANDOVER 의 수익 모델이 편집기에 닿는 순간, 위
"paywall creep" 항목 전체가 우리 것이 된다.

#### 그리고 ADR-0006 을 정면으로 건드리는 한 마디

CapCut 을 쓰다 **iMovie 로 되돌아간** 사용자의 글:

> "in iMovie, if I wanted to insert an audio/video clip, **it automatically
> shifted everything over**… In capcut… I have to manually shift everything over
> myself. **Edit: Switched back to iMovie and finished my video easily.**"
> (https://www.reddit.com/r/CapCut/comments/1ed1mzh/its_ridiculous_i_cant_insert_clips_without_manually_shifting/)

이건 G10 의 자동 reflow 논쟁에 대한 **초보자 쪽의 유일한 직접 증거**다. 자세히
읽을 가치가 있으므로 G10 에서 다시 다룬다.

---

## 3. 브라우저 편집기 고유의 고통 — 우리의 직접 경쟁이자 직접 위험

이 절은 다르게 읽어야 한다. 위 항목들은 "우리가 고칠 수 있는 남의 문제"지만,
여기 있는 것은 **우리가 물려받는 문제**다.

### B1. 브라우저 저장소가 곧 세이브 파일이다 — 캐시를 지우면 작업이 사라진다

Microsoft 답변자가 직접 쓴 문장:

> "Clipchamp projects are saved in your browser storage, not automatically in
> OneDrive… **If browser data was cleared recently, unfortunately local projects
> usually can't be recovered.**" — 2026-02-26

Clipchamp 은 프로젝트를 IndexedDB(LevelDB)에 저장했고, 2025년 말~2026년 초
OneDrive 강제 이전이 **로컬 프로젝트를 통째로 고아로 만들었다**:

> "MICROSOFT DELETED ALL MY PROJECTS… I open Clipchamp and get hit with the
> popup" · "After the update, all the videos are just gone, they're not even
> saved to OneDrive"

**출처:** https://learn.microsoft.com/en-us/answers/questions/5788957/i-lost-all-my-projects-2-days-ago ·
https://help.clipchamp.com/en/articles/2019641-why-have-i-lost-changes-to-my-project ·
https://medium.com/@21stCenturyArchives/microsoft-killed-my-clipchamp-projects-and-heres-how-i-got-them-back-adbb57f6a0a9

**framewright 위험도: 높음. 그리고 우리가 더 취약하다.**

Clipchamp 은 IndexedDB 를 쓴다. framewright 는 **`localStorage`** 를 쓴다
(`STORAGE_KEY = 'framewright:project'`). 세 가지가 따라온다.

1. **Safari/WebKit 은 스크립트가 쓴 저장소를 7일 무상호작용 후 삭제한다.**
   iOS 13.4 / Safari 13.1 부터 IndexedDB, LocalStorage, SessionStorage,
   Service Worker 등록이 모두 대상이다. 당시 개발자 반응이 이 위험을 한 줄로
   요약한다: **"Basically, you go on vacation and the data is lost."**
   (https://support.didomi.io/apple-adds-a-7-day-cap-on-all-script-writable-storage ·
   https://www.itnews.com.au/news/apple-cops-flak-for-deleting-local-browser-storage-after-7-days-539833)
   ADR-0001 이 Chromium-first 라 당장의 타격은 제한적이지만, **"3일 뒤에 돌아온
   소유자"는 `CLAUDE.md` 가 명시적으로 상정하는 사용자다.**

2. **`navigator.storage.persist()` 를 호출하지 않는다.** 레포 전체에
   `navigator.storage` 호출이 없다. 이 API 는 2021-12 부터 Baseline Widely
   Available 이고, 승인되면 저장소가 **"cleared except by explicit user
   action"** 이 된다. 지금은 저장소 압박 시 evict 대상이다.
   (https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)

3. **localStorage 는 약 5MB 다.** 프로젝트 JSON + 최대 30개 버전 스냅샷이
   같은 키에 들어간다. 긴 타임라인에서 조용히 한계에 닿을 수 있다.

**우리가 이미 잘하고 있는 것도 적는다** — 이건 진짜 좋다:

- 비공개 모드 감지 (`probe` 로 write 시도) 후 평이한 문구로 알림
- **다른 탭이 먼저 저장했으면 덮어쓰기를 거부**(`generation` 비교) — Premiere 의
  "두 탭이 프로젝트를 뭉갠다" RUNBOOK 항목에 대한 실제 구현
- `pagehide` + `visibilitychange` 양쪽에서 flush
- 손상된 문서는 `deserialize` 가 거부 (_"losing an autosave is bad, but loading
  a corrupted document is worse"_)

### B2. 미디어를 다시 올려야 한다 / 다시 골라야 한다

브라우저 편집기의 표준 세금이다.

> "It takes anywhere from 30 minutes to 1 hour to upload ONE video clip… Once it
> is finished uploading, it disappears from the 'My Media' list"
> — Conner S., 1★ Capterra (Clipchamp), 2023-03-31

> "Since it is cloud based, uploading and downloading can take a while."
> — Craig D., Capterra (WeVideo)

> "the desktop app uses a lot of my laptop ram/resources while I am editing as
> it continuously tries to sync with the cloud after every minor edit"
> — Nathan Bray (Descript)

**framewright 위험도: 중간 — 그리고 우리는 반대편 극단에 있다.**

우리는 업로드가 없다(구조적 승리). 대신 **아무것도 보관하지 않아서** 매 세션
파일을 다시 고르게 한다(G5). 정답은 가운데 어딘가다: OPFS 캐시, 또는 File
System Access 핸들을 IndexedDB 에 저장해 권한만 재확인하는 방식. ADR-0004 가
이미 OPFS 를 지목해 뒀다 — **구현되지 않았을 뿐이다.**

### B3. export 가 남의 서버에서, 줄을 서서 돌아간다

Kapwing 자체 문서:

> "Standard quality videos take at least as long as their duration to process.
> For example, a 10 minute video will take at least 10 minutes to process."
> "Processing takes longer during peak hours, especially Monday/Tuesday mornings
> EST." (https://www.kapwing.com/help/video-processing-faq/)

> "Support is slow. Somtimes the exports can take some time depending on the
> queue." — Osama K., Capterra (WeVideo)

**framewright 위험도: 없음. 구조적 우위다.**

export 는 전부 로컬 WebCodecs 다. 대기열도, peak hour 도, 업로드 왕복도 없다.
**이건 우리가 가진 가장 명확한 우위이고 지금 아무 데도 안 적혀 있다.**

### B4. "탭을 벗어나지 마세요" ★

Microsoft 공식 지원 문서가 문자 그대로:

> **"Keep Clipchamp in the foreground. Do not switch tabs or windows during
> export."** — 함께: 확장 프로그램 끄기, 시크릿 모드 피하기, 긴 프로젝트는
> 잘라서 따로 export 후 이어 붙이기.
> (https://support.microsoft.com/en-us/clipchamp/exporting-from-clipchamp-troubleshooting)

브라우저 편집기의 본질을 이보다 잘 요약하는 문장은 못 찾았다. 벤더가 사용자에게
**가만히 있으라고** 지시하고 있다.

**framewright 위험도: 높음. 그리고 이건 이 조사에서 나온 새 결함이다. 아래 4절.**

### B5. export 가 실패하는데 이유가 없다 (브라우저판)

G3 의 브라우저 버전인데, 지원 답변의 *모양*이 다르다. 표준 답변이 **"다른
브라우저로 해보세요, 시크릿 모드로 해보세요, 캐시를 지우세요"** 다. 즉
브라우저 편집기가 사용자에게 **런타임을 디버깅하라고** 시킨다.

- https://community.adobe.com/bug-reports-328/adobe-express-failing-to-export-videos-animations-1468797
- https://veed.pissedconsumer.com/review.html
  (_"The video cannot be rendered as it shows error during rendering... it's
  been more than 3 hrs"_, 2026-01-02)

**framewright 위험도: 중간.** WebCodecs 지원 여부는 `isConfigSupported()` 로
사전 탐지하도록 ADR-0005 가 정해뒀고 RUNBOOK 에 문구 규칙이 있다. 다만
**Playwright 번들 Chromium 에 H.264 가 없어 import/export 스펙이 self-skip
한다**는 사실 자체가, 사용자 환경에 따라 코덱이 없을 수 있다는 살아 있는
증거다.

### B6. 브라우저 메모리 한계와 캐시 폭주

> "Microsoft Clipchamp will not record for 30 minutes. Getting an out of memory
> error. I have done all recommended steps." — craig carlton (**유료 구독자**,
> 백그라운드 앱 종료·캐시 초기화·확장 비활성화·미디어 압축을 모두 마친 뒤)

> "plenty of files are saved in browser caches, downloaded on disk, generated as
> MP4s, spread a bit everywhere" — 며칠 만에 ~200GB.
> "Less than 10 minutes with just your talking-head will be saved in more than
> 1 GB on disk" — Cristian Scutaru, 2024-01-10

**framewright 위험도: 중간.** golden rule 6(모든 `VideoFrame`/`AudioData` 닫기)
과 guardrail hook 이 정확히 이걸 막는다. 다만 tech debt 가 인정하듯 **오디오는
`decodeAudioData` 로 파일 전체를 메모리에 올린다.** 짧은 클립 전제 안이다.

### B7. 무료 한도를 작업이 끝난 뒤에 알게 된다

> "It was not made clear how much publishing time was available for a free
> account **until after I had spent hours editing a video**… By my fourth time,
> I had used up my monthly publishing time." — Ellen G., Capterra (WeVideo)

> "half of the video is gone, because you'd have to upgrade to the most
> expensive Business plan" — Mateja K.

> "If you want to keep more than THREE videos, JUST THREE at one time, you have
> to pay" … "you can only have them in for THREE DAYS" — anaya malik (Kapwing)

**framewright 위험도: 현재 없음.** 요금제가 없다. **미래 위험은 실재한다** —
HANDOVER 의 수익 모델(구독/멤버십, B2B SaaS, 라이브 후원)이 편집기에 닿는
순간 이 항목이 우리 것이 된다. **위 인용의 공통점은 "한도가 있다"가 아니라
"작업이 끝난 뒤에 알았다"이다.**

### B8. watermark — 예상보다 훨씬 작은 문제였다

이건 브리핑의 가설을 뒤집은 발견이다. 브라우저 편집기 5종의 **부정 리뷰 약
110건**을 읽은 결과, **강제 export watermark 불만은 사실상 없었다.** 유일한
진짜 사례가 Canva 의 QR 코드 로고 잠금이다:

> "I can't make a QR code with their software that does not have their stupid
> logo being in the center unless I give them $250 per year because $144 per
> year just wasn't enough." — Trustpilot, 2026-08-09

(Kapwing 의 _"WHY IS THE WATERMARK SO DANG BIG"_ 같은 예전 Product Hunt 리뷰는
존재하지만 최근 코퍼스에서는 소수다.)

**사람들이 실제로 화내는 것은 paywall creep** — 무료였던 기능이 Pro 로 가는
것이다. CapCut 의 _"STOP MAKING EVERYTHING PRO!"_ 가 그 형태다. 이건 B7 과 같은
범주이지 watermark 범주가 아니다.

**주의: 이 비율 판단은 계산된 통계가 아니라 눈으로 읽은 인상이다.** 그리고
플랫폼에 강하게 좌우된다 — PissedConsumer 는 구조상 결제 불만이 지배하고,
Microsoft Q&A 나 Capterra cons 는 export 실패가 지배한다.

### B9. 두 개의 버킷은 사실 하나다 — export 실패가 곧 작업 소실이다

가장 중요한 구조적 발견일 수 있다. **(b) export 실패와 (c) 작업 소실은 종종
같은 사건이다** — export 하려는 순간에 프로젝트가 사라진 걸 알게 된다.

> "When I started exporting the video, I suddenly received a message saying,
> 'Video unavailable.' After refreshing the page, the edited video was
> completely missing." — 2★ Trustpilot (VEED), 2026-08-03

그리고 (d) 결제 분노의 상당수는 export 실패가 **유발한** 환불 요구다:

> "Uploads not working or taking forever… the program can't download them and
> you need to break them up into chunks… And sure enough, Kapwing will not
> refund me my remaining subscription months." — Kaye W., 1★ Capterra,
> 2025-01-26

### B10. 브라우저 편집기의 정직한 장점

균형을 위해, 그리고 이게 우리 논거이기도 하므로:

> "Works on Chromebooks; no software to install!" — Rikki S., Capterra
> "I can stop work and pick it back up where ever I am and on any machine"
> — Tom G., Capterra
> "Kapwing makes it very easy to edit videos right in the browser."
> — Product Hunt

- **설치 없음 / 어떤 기기에서나** — 가장 많이 반복된 칭찬.
- **자동 자막이 실질적 킬러 기능이다.** Kapwing 리뷰에서 편집 자체보다 더 자주
  언급된다: _"the automatic subtitle generator feature in Kapwing is a big one
  for me"_.
- **협업과 공유는 데스크톱보다 진짜로 낫다.** 교사들이 위의 모든 불만을 감수하는
  이유가 이것이다.
- **평판이 나쁠 필연은 없다.** Clipchamp 의 Trustpilot 4.7 / 6,471건(초대
  리뷰 없음)이 증거다.

---

## 4. 레포와 대조 — 새로 발견한 두 가지

조사 중 코드를 함께 읽으면서, **기존 tech debt 목록에 없는** 두 항목이 나왔다.
둘 다 위 인용들과 직접 대응한다.

### 4-1. ★ 백그라운드 탭에서 export 가 사실상 멈춘다

B4("Do not switch tabs during export")를 우리 코드에 대보면 이렇다.

`src/engine/exporter.ts` 는 메인 스레드에서 돌면서 5프레임마다, 그리고 인코더
백프레셔 루프에서 `await new Promise((r) => setTimeout(r, 0))` 로 양보한다
(71행, 312행, 317행).

Chrome 의 타이머 스로틀링 규칙
(https://developer.chrome.com/blog/timer-throttling-in-chrome-88):

- 탭이 숨겨지면 **1초에 한 번**으로 묶인다 (Tier 2)
- 숨겨진 지 5분 초과 + 타이머 체인 5 이상 + 30초 이상 무음 + WebRTC 미사용이면
  **1분에 한 번** (Tier 3, "intensive throttling")

export 중에는 소리를 내지 않고 WebRTC 도 없으므로 **Tier 3 조건을 전부
충족한다.** 즉 사용자가 export 를 걸어 놓고 다른 탭으로 가면, 진행이
1분에 한 번 양보하는 속도로 떨어질 수 있다.

RUNBOOK 3절은 재생에 대해 이미 이 계열을 다룬다("Jumpy when tab backgrounded →
rAF throttled → pause playback on `visibilitychange`", 실제로 `Preview.tsx` 가
구현). **6절 Export 표에는 이 항목이 없다.** 있는 것은 "UI frozen during export
→ Worker + OffscreenCanvas" 인데, 이유가 다르다 — 지금 문제는 UI 멈춤이 아니라
**백그라운드에서의 정지**다.

Worker 로 옮기는 것이 근본 해결이고 이미 RUNBOOK 이 요구한다. 그 전까지의 정직한
임시 대응은 **말해 주는 것**이다: export 중 `visibilitychange` 로 탭이 숨겨지면
"탭을 보이는 상태로 두면 더 빨라요" 를 상태줄에 띄우는 것. Clipchamp 이 지원
문서에 묻어 둔 문장을, 우리는 필요한 순간에 화면에서 말하면 된다.

**확인 방법**: 이 문서는 스로틀링 규칙과 코드를 대조한 결과이고, **실측하지
않았다.** 실제 export 를 걸고 탭을 5분 이상 숨겨 보는 것이 다음 단계다.

### 4-2. 미디어가 보존되지 않는다 (ADR-0004 의 미이행)

G5 / B2 에서 다뤘지만 코드 사실만 한 번 더 못박는다:

- `Asset.opfsKey` 는 `types.ts:36` 에 선언돼 있고 주석은 `// local cache key
(future)`
- 레포 어디에도 `navigator.storage.getDirectory` 호출이 없다
- `storage.ts` 주석: _"Only the small JSON document is stored — media stays out
  of it."_

**ADR-0004 는 "MVP persists locally (OPFS + serializable project JSON)" 라고
적혀 있다.** 즉 이건 규범적(prescriptive) 문서와 코드의 불일치다 —
`CLAUDE.md` 의 규율에 따르면 **문서를 고치는 게 아니라 코드의 미이행을 먼저
의심**해야 하는 종류다. 지금 상태는 "OPFS 를 쓰기로 했는데 아직 안 썼다"이고,
그 사실이 ADR 에도 tech debt 에도 적혀 있지 않다.

---

## 5. ADR 과 사용자 요구가 충돌하는 지점

| ADR / 결정                                             | 사용자들이 말하는 것                                                                                                                                                                   | 판정                                                                                                                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0006** — magnetic/ripple 자동 reflow 거부            | 갈린다. **숙련자 반대** 사례는 전부 외부 타이밍 제약(음악 싱크)을 가진 사람. **초보자 쪽엔 정반대 증거가 하나 있다** — 자동 밀어내기가 없어서 CapCut 을 버리고 iMovie 로 돌아간 사용자 | **유지, 조건부.** 그 초보자가 원한 건 상시 reflow 가 아니라 "삽입하면 자리를 만들어 줄 것"이고, ADR-0007 의 `clip.paste` 가 이미 정확히 그렇게 한다. 문제는 그 경로가 붙여넣기 하나뿐이고 발견하기 어렵다는 것 (G10 참조) |
| **0006** — gap 은 합법이고 보이게 그린다               | Premiere 의 `close gap` 은 다른 트랙 때문에 조용히 실패한다                                                                                                                            | **유지, 우위**                                                                                                                                                                                                            |
| **0004** — local-first, OPFS + repository seam         | B1/B2 가 정확히 이 문제. 그런데 **OPFS 부분이 미구현**                                                                                                                                 | **결정은 옳고, 이행이 안 됐다.** 4-2 참조                                                                                                                                                                                 |
| **0005** — H.264/AAC MP4 only, HEVC 는 라이선스로 제외 | Resolve 무료판의 HEVC 미지원이 **"Media Offline"** 이라는 거짓 메시지로 나타나 최악의 사용자 경험을 만든다                                                                             | **결정은 유지.** 다만 **입력** HEVC(아이폰·GoPro·DJI 기본 포맷)를 만났을 때 무엇을 말할지가 진짜 문제다. RUNBOOK 1절이 "clear message + transcode 제안"으로 이미 답을 정해 뒀다 — 지키면 된다                             |
| **0002** — CFR 정수 프레임, VFR 은 import 시 conform   | Premiere 의 preview≠export 원인 중 하나가 **아이폰 VFR** 이다                                                                                                                          | **유지, 우위.** 정확히 그 버그를 구조적으로 막는 결정                                                                                                                                                                     |
| **0007** — keymap 은 데이터, 충돌은 보고               | 사용자가 가장 분노하는 것이 "업그레이드하니 단축키가 사라졌다"                                                                                                                         | **유지, 그러나 미완.** preset·import/export 부재와 유령 override 미정리가 같은 버그를 재현할 수 있다 (G7)                                                                                                                 |
| **0003** — 모든 편집은 명령 + 역명령                   | Premiere 의 razor cut 이 숨은 `Set Property` 항목을 하나 더 만들어 undo 의미와 반응성을 동시에 망가뜨렸다                                                                              | **유지, 우위.** ADR-0006 의 "one gesture = one undo step" 이 이미 답                                                                                                                                                      |
| **0001** — Chromium-first                              | Safari 의 7일 저장소 삭제, WebCodecs 미지원                                                                                                                                            | **유지.** 다만 Safari 사용자가 들어왔을 때 **저장이 사라질 수 있다는 사실**을 감지해 말해야 한다                                                                                                                          |
| **RUNBOOK 5절** — `schemaVersion` + 마이그레이션 러너  | Premiere 는 2024 프로젝트를 2025 에서 못 열고, CapCut 은 구버전으로 내려간 사용자가 자기 프로젝트를 못 연다(해법이 JSON 손편집)                                                        | **유지, 우위.** 단 마이그레이션 러너는 **아직 필요해진 적이 없다** — 처음 필요해지는 순간이 시험대다                                                                                                                      |
| `docs/UX.md` — "no expert persona"                     | 이 조사에서 초보자의 육성은 가장 얻기 어려웠다. 압도당한 사람은 글을 안 쓰고 떠난다                                                                                                    | **유지.** 다만 증거 수집 방법의 한계로 인식할 것                                                                                                                                                                          |

---

## 6. 무엇을 하자

우선순위 순. 각 항목은 **근거가 된 불만 그룹** → **레포의 현재 상태** →
**제안** 이다. 이건 제안이지 결정이 아니다.

### 1. 미디어를 보존해서 relink 를 없앤다 (OPFS 또는 파일 핸들)

- **근거**: G5(relink 지옥, 4개 제품 공통), B2, 그리고 **ADR-0004 미이행**
- **현재**: `opfsKey` 는 선언만, OPFS 호출 없음. 매 새로고침 파일 재선택
- **제안**: OPFS 에 미디어를 캐시하거나, File System Access 핸들을 IndexedDB 에
  보관해 권한만 재확인. 어느 쪽이든 `storage.ts` 의 repository seam 뒤에서
  한다. 크기 관리는 RUNBOOK 5절이 이미 예고해 둔 대로 quota 감지 + 조기 경고
- **왜 1순위**: 이건 우리 제품의 _현재_ 결함이고, 사용자가 이탈하는 지점이며,
  이미 결정된 아키텍처를 이행하는 일이라 새 논쟁이 없다

### 2. 저장소가 사라질 수 있다는 사실을 다룬다

- **근거**: B1, G1(autosave 배신)
- **현재**: `localStorage` 단독. `navigator.storage.persist()` 미호출. 자동
  스냅샷 10개 회전
- **제안** (셋 다 작다):
  1. `navigator.storage.persist()` 호출 + 거부 시 사용자에게 평이하게 알림
  2. 프로젝트를 **파일로 내보내기/불러오기** (`.json`). 브라우저 저장소가
     지워져도 살아남는 유일한 길이고, "내 작업은 내 것"이라는 G8 포지셔닝과
     같은 방향
  3. Safari/WebKit 감지 시 7일 삭제 정책을 미리 말해 주기
- **주의**: `pruneVersions` 의 manual 버전 보호는 이미 옳다. 바꾸지 말 것

### 3. export 가 백그라운드 탭에서 멈추는 문제 (4-1)

- **근거**: B4, 그리고 Chrome 스로틀링 규칙 + 우리 코드의 대조
- **현재**: 메인 스레드 + `setTimeout(0)` 양보. RUNBOOK 6절에 항목 없음
- **제안**: (a) **먼저 실측한다** — 5분 이상 숨긴 탭에서 export 를 걸어 확인.
  (b) 재현되면 RUNBOOK 6절에 항목을 추가하고, 단기 대응으로
  `visibilitychange` 시 상태줄 안내. (c) 근본 해결은 이미 RUNBOOK 이 요구하는
  **Worker + OffscreenCanvas**
- **왜 3순위**: 미확인이지만 확인 비용이 매우 싸고, 사실이면 심각하다

### 4. export 실패 시 **어느 클립인지** 말한다

- **근거**: G3 전체. 이 조사에서 가장 자주 나오고 가장 싸게 고쳐지는 계열
- **현재**: `ExportButton` 이 `⚠ N프레임은 원본을 읽지 못해…` 로 **개수**는
  말한다. 미디어 누락 시 시작 거부도 이미 한다
- **제안**: 실패/대체된 프레임이 속한 **클립 이름과 타임라인 위치**까지 말한다.
  iMovie 사용자가 33% 지점의 문제 클립을 눈으로 찾아야 했던 것과, FCP 사용자가
  11일 걸린 것이 전부 이 정보의 부재다

### 5. keymap preset 과 import/export (G7 의 두 tech debt 해소)

- **근거**: G7. "업그레이드하니 단축키가 사라졌다"가 이 코퍼스에서 가장 분노가
  큰 항목
- **현재**: `localStorage` 전용, preset 없음, 죽은 override 미정리
- **제안**: (a) keymap 을 파일로 내보내기/불러오기 — 2번의 프로젝트 내보내기와
  같은 작업 덩어리. (b) **Premiere 프리셋**: `c`/`delete`/`q`/`w` 가 이미
  Premiere 관례이므로 새로 설계할 게 거의 없다. 이름을 붙이고 목록을 만드는
  일. (c) 죽은 override 를 정리하고 **보고**한다 (Premiere 의 F5/F6 유령
  바인딩 버그)

### 6. golden-file export QC (기존 tech debt 승격)

- **근거**: G2. Premiere 단일 스레드 10명, Clipchamp 3명 독립 확인
- **현재**: e2e 가 프레임 수와 duration 만 확인
- **제안**: 바이트 비교 또는 프레임 해시. **이건 gold-plating 이 아니다** —
  위 불만들은 전부 "개수는 맞는데 내용이 다르다" 계열이라 현재 검사가
  구조적으로 못 잡는다

### 7. 자막을 E7 의 첫 번째로 (순서 조정 제안)

- **근거**: B10. 자동 자막은 브라우저 편집기 리뷰에서 **편집 기능 자체보다 더
  자주 칭찬받는다**. G11 의 iMovie 이탈과도 맞물린다
- **현재**: `Track.type` 에 `'text'` 가 이미 있고 클립은 없다. E7 항목
- **제안**: E7 안에서 자막을 먼저. 다만 **자동 인식(ASR)은 별개 결정**이다 —
  로컬에서 할지 서버로 보낼지가 G8 포지셔닝을 직접 건드린다. 서버로 보내는
  순간 "업로드 없음"이라는 우리 우위가 무너진다

### 8. "잘라내기" 세 개 이름 정리 (STATUS 의 미결 항목)

- **근거**: G9/G6 이 아니라 G3 의 사촌 — 사용자가 잘못된 버튼을 누른다.
  `docs/STATUS.md` 가 소유자 결정 대기로 남겨 둔 항목
- **조사에서 온 보강**: FCP 스레드에서 **답변하는 전문가조차 magnetism 과
  snapping 을 구분하지 못했다.** 편집기 용어의 모호함은 실제로 사람을 잘못된
  답으로 인도한다. 이건 취향 문제가 아니다

### 9. "여기에 끼워 넣기"를 발견 가능한 명령으로 만든다

- **근거**: G10 의 초보자 증거 — 자동 밀어내기가 없어서 CapCut 을 버린 사용자.
  그리고 `CLAUDE.md` tech debt 의 _"a paste always lands on the video track, and
  the insert point snaps to a clip boundary rather than splitting"_
- **현재**: 그 동작(`clip.paste`)은 **이미 옳게 구현돼 있다** — 필요한 만큼만
  뒤 클립을 밀고, 밀었다고 말한다. 문제는 경로가 `mod+v` 하나뿐이라는 것
- **제안**: ADR-0006 을 뒤집지 말 것. 대신 같은 의도를 툴바/팔레트에서 이름으로
  도달할 수 있게 한다. **자동 모드를 켜는 게 아니라 명시적 명령을 보이게 하는
  것**이 이 증거에 대한 올바른 응답이다

### 10. 우리가 이미 가진 것을 말한다 (문서 아닌 제품에서)

- **근거**: G8·G13·B3·B4 전체. framewright 는 요금제·계정·업로드·watermark·
  대기열·"탭을 벗어나지 마세요"가 **전부 없다.** 그게 CapCut·Clipchamp·VEED
  불만 목록의 정확한 보색이다
- **현재**: 어디에도 적혀 있지 않다. UI 에도, README 에도
- **제안**: 이건 마케팅 문구가 아니라 **신뢰 신호**다. 예: 첫 실행 시 "영상은 이
  브라우저 밖으로 나가지 않아요" 한 줄. 단 G9 의 교훈대로 **frame accuracy 를
  내세우지 말고 결과로 말할 것**
- **주의**: 1-B 가 보여주듯 Clipchamp 무료가 이미 1080p watermark 없이 무제한
  export 다. **"무료"는 차별점이 아니다.** 차별점은 "업로드하지 않는다"이다

### 11. 하지 말자고 정한 것들 (명시적 거부)

- **magnetic / 자동 ripple reflow**: ADR-0006 유지. G10 참조
- **watermark**: B8 이 보여주듯 불만 자체는 적지만, 우리가 넣을 이유가 없다
- **클라우드 export / 서버 렌더**: B3 의 모든 고통을 스스로 수입하는 일
- **원본 업로드**: G8. Descript 가 간 방향의 반대편에 서 있는 것이 우리 자산
- **frame accuracy 를 셀링 포인트로 내세우기**: G9. 아무도 검색하지 않는다.
  결과("정확히 여기서 잘린다", "export 가 preview 와 같다")로 말할 것

### 12. 이 코퍼스에서 나온 게 **아닌** 세 가지 (그래도 같이 결정해야 한다)

앞의 1~11 은 사용자 불만에서 나왔다. 아래 셋은 **우리 레포의 사고 이력과 배포
계획**에서 나왔다. 근거의 출처가 다르므로 구분해서 적는다 — 사용자가 이렇게
말했다고 읽으면 안 된다.

- **픽스처 코퍼스.** 근거는 이 조사가 아니라 `docs/HANDOVER.md` 의 "이미 배포한
  버그" 목록이다. 픽스처가 `sample-h264.mp4` **하나**인데 거기서만 두 종류의
  결함이 나왔다(2프레임 offset, 그리고 회전 메타데이터 무시는 아직 미해결).
  아이폰 HEVC·안드로이드 VFR·화면녹화·회전본은 사용자 파일에서 한꺼번에
  들어온다. 다만 이 조사가 간접적으로 뒷받침은 한다: G3("export 가 깨진다")
  계열의 상당수가 특정 소스 파일 형태에서만 재현되는 문제다.
- **가져온 파일 진단 한 줄** (offset·edit list·VFR·회전). 4번(“export 실패 시
  어느 클립인지 말한다”)의 앞단 버전이다. `startOffsetSec` 은 ADR-0008 로 이미
  손에 있다. 사용자에게는 신뢰 신호이고, 우리에게는 버그 리포트 재료다.
- **배포 형태: 정적 호스팅이냐 백엔드냐.** 소유자가 AWS 배포를 목표로 세웠다.
  이 조사는 **정적/로컬 우선 쪽에 분명히 힘을 싣는다** — B3(클라우드 export
  대기열), B4("탭을 벗어나지 마세요"), G8(업로드 자체에 대한 거부감)이 전부
  서버 렌더의 비용이고, 11번은 그것들을 명시적으로 거부한다. 반대로 계정·공유·
  프로젝트 동기화를 하려는 순간 그 우위를 스스로 반납한다. **즉 이건 인프라
  선택이 아니라 포지셔닝 선택이다.**

---

## 부록 — 이 문서를 다시 쓸 사람에게

- **★ Reddit 은 RSS 로 읽을 수 있다.** `reddit.com` 직접 접근은 막혀 있지만
  서브레딧 `top.rss` / `new.rss` / `search.rss` 와 스레드별 댓글 `.rss` 는
  살아 있다. G13(CapCut)이 그 방법으로 나왔고, 이 문서에서 증거 품질이 가장
  높은 절이다. **다음 사람은 같은 경로를 r/editors · r/VideoEditing ·
  r/premiere · r/davinciresolve 에 쓰면 된다** — 이 문서의 가장 큰 공백(G6
  초보자 육성, G9 최신성, 프라이버시 수요)이 그걸로 메워진다.
- **Google Play 리뷰는 `batchexecute` RPC 로 원문을 받을 수 있다.** 1★만
  따로 뽑는 것도 된다.
- **G2 는 한 번도 성공하지 못했다.** 이 문서의 G2 수치는 인용 금지.
- **Trustpilot 은 `r.jina.ai` 텍스트 추출 프록시로 뚫렸다.** Cloudflare 계열
  차단에 대해 "차단됨"으로 결론 내기 전에 시도해 볼 것.
- **Mac App Store 집계는 API 로 안 나온다** (Microsoft Word 도 0 을 돌려준다).
  "리뷰가 없다"로 읽지 말 것.
- **비율 판단(B8 등)은 계산이 아니라 읽은 인상이다.** 약 110건 기준.
