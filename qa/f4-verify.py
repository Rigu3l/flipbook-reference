import json, time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8903"
PDF = "/home/hatch/workspace/reverse/heyzine/sample.pdf"
QA = "/home/hatch/workspace/flipbook-reference/qa"
BOOK_ID = "11111111-2222-3333-4444-555555555555"
BOOK = {"id": BOOK_ID, "title": "F1 Test Book", "file_path": "test-user/f1-test-book.pdf",
        "page_count": 4, "views": 0, "has_password": False}

def mock(page):
    page.route("**/rest/v1/public_flipbooks*", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps([BOOK])))
    page.route("**/rest/v1/rpc/increment_flipbook_views", lambda r: r.fulfill(status=200, content_type="application/json", body="1"))
    page.route("**/storage/v1/object/public/pdfs/**", lambda r: r.fulfill(status=200, content_type="application/pdf", path=PDF))
    page.route("**/auth/v1/**", lambda r: r.abort())

def label(page): return page.locator("#page-label").inner_text()
def shot(page, name): page.screenshot(path=f"{QA}/{name}.png"); print("shot:", name)
def mode(page): return page.locator("#mode-select").input_value()

with sync_playwright() as p:
    b = p.chromium.launch(
        executable_path="/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
        args=["--no-sandbox", "--no-proxy-server", "--ignore-certificate-errors"])
    page = b.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    mock(page)
    page.goto(f"{BASE}/viewer.html?id={BOOK_ID}", wait_until="networkidle")
    page.wait_for_selector("#stage:not(.hidden)", timeout=20000)
    time.sleep(0.5)
    print("default mode:", mode(page), "| label:", label(page), "| canvases:", page.locator("#stage-inner canvas").count())
    page.click("#btn-next")
    page.wait_for_function("() => document.querySelector('#page-label').textContent.includes('2')", timeout=10000)
    time.sleep(0.4)
    print("magazine next: label =", label(page))
    shot(page, "f4-01-magazine")

    # Slider
    page.select_option("#mode-select", "slider")
    page.wait_for_function("() => document.querySelectorAll('#stage-inner canvas').length === 1", timeout=10000)
    time.sleep(0.4)
    print("slider: mode =", mode(page), "| label =", label(page), "| canvases:", page.locator("#stage-inner canvas").count())
    page.click("#btn-next")
    page.wait_for_function("() => document.querySelector('#page-label').textContent === 'Page 3 of 4'", timeout=10000)
    print("slider next: label =", label(page))
    shot(page, "f4-02-slider")

    # Fade
    page.select_option("#mode-select", "fade")
    time.sleep(0.6)
    print("fade: mode =", mode(page), "| label =", label(page), "| canvases:", page.locator("#stage-inner canvas").count())
    page.click("#btn-next")
    page.wait_for_function("() => document.querySelector('#page-label').textContent === 'Page 4 of 4'", timeout=10000)
    print("fade next: label =", label(page))
    shot(page, "f4-03-fade")

    # Coverflow
    page.select_option("#mode-select", "coverflow")
    page.wait_for_selector("#coverflow:not(.hidden) .cf-card", timeout=10000)
    time.sleep(0.6)
    print("coverflow: mode =", mode(page), "| label =", label(page), "| cards:", page.locator(".cf-card").count(),
          "| zoom-in disabled =", page.locator("#btn-zoom-in").is_disabled())
    shot(page, "f4-04-coverflow")
    page.locator(".cf-card[data-page='2']").click()
    page.wait_for_function("() => document.querySelector('#page-label').textContent === 'Page 2 of 4'", timeout=10000)
    time.sleep(0.5)
    print("coverflow click page 2: label =", label(page))
    shot(page, "f4-05-coverflow-page2")

    # One page
    page.select_option("#mode-select", "onepage")
    page.wait_for_function("() => document.querySelectorAll('#stage-inner canvas').length === 1", timeout=10000)
    time.sleep(0.4)
    print("onepage: mode =", mode(page), "| label =", label(page), "| canvases:", page.locator("#stage-inner canvas").count(),
          "| zoom-in enabled =", page.locator("#btn-zoom-in").is_enabled())
    page.click("#btn-next")
    page.wait_for_function("() => document.querySelector('#page-label').textContent === 'Page 3 of 4'", timeout=10000)
    print("onepage next: label =", label(page))

    # Back to magazine
    page.select_option("#mode-select", "magazine")
    time.sleep(0.6)
    print("magazine again: mode =", mode(page), "| label =", label(page), "| canvases:", page.locator("#stage-inner canvas").count())

    # Persistence: set slider, reload
    page.select_option("#mode-select", "slider")
    time.sleep(0.5)
    page.reload(wait_until="networkidle")
    page.wait_for_selector("#stage:not(.hidden)", timeout=20000)
    time.sleep(0.5)
    print("after reload: mode =", mode(page), "| label =", label(page), "| canvases:", page.locator("#stage-inner canvas").count())
    print("JS errors:", errs if errs else "none")
    b.close()
    print("F4 LOCAL VERIFY DONE")
