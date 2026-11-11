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
    print("toolbar visible:", page.locator("#toolbar").is_visible(), "| slider max:", page.locator("#page-slider").get_attribute("max"), "| slider value:", page.locator("#page-slider").input_value())

    # Thumbnails
    page.click("#btn-thumbs")
    page.wait_for_selector("#thumbs-panel:not(.hidden)", timeout=5000)
    time.sleep(1)
    print("thumbs: panel visible =", page.locator("#thumbs-panel").is_visible(), "| thumbs =", page.locator(".thumb-btn").count())
    shot(page, "f3-01-thumbs")
    page.locator(".thumb-btn[data-page='3']").click()
    page.wait_for_function("() => document.querySelector('#page-label').textContent.includes('2')", timeout=10000)
    time.sleep(0.3)
    print("thumb 3 click: label =", label(page), "| thumb 3 highlighted =", page.locator(".thumb-btn[data-page='3']").evaluate("el => el.classList.contains('ring-2')"))
    page.click("#btn-thumbs")
    print("thumbs closed:", page.locator("#thumbs-panel").is_hidden())

    # Zoom
    w0 = page.locator("#stage canvas").first.evaluate("el => el.getBoundingClientRect().width")
    page.click("#btn-zoom-in")
    page.wait_for_function("() => document.querySelector('#zoom-label').textContent === '125%'", timeout=10000)
    time.sleep(0.5)
    w1 = page.locator("#stage canvas").first.evaluate("el => el.getBoundingClientRect().width")
    print("zoom 125%: label =", page.locator("#zoom-label").inner_text(), "| canvas width", round(w0), "->", round(w1))
    page.click("#btn-zoom-in")
    page.wait_for_function("() => document.querySelector('#zoom-label').textContent === '150%'", timeout=10000)
    print("zoom 150%: label =", page.locator("#zoom-label").inner_text())
    shot(page, "f3-02-zoomed")
    page.click("#btn-zoom-fit")
    page.wait_for_function("() => document.querySelector('#zoom-label').textContent === '100%'", timeout=10000)
    print("fit: label =", page.locator("#zoom-label").inner_text())

    # Fullscreen
    page.click("#btn-fullscreen")
    page.wait_for_function("() => !!document.fullscreenElement", timeout=5000)
    print("fullscreen: active =", page.evaluate("() => !!document.fullscreenElement"), "| button =", page.locator("#btn-fullscreen").inner_text())
    page.click("#btn-fullscreen")
    page.wait_for_function("() => !document.fullscreenElement", timeout=5000)
    print("fullscreen exit: active =", page.evaluate("() => !!document.fullscreenElement"), "| button =", page.locator("#btn-fullscreen").inner_text())

    # Slider
    page.locator("#page-slider").fill("4")
    page.wait_for_function("() => document.querySelector('#page-label').textContent.includes('4 of')", timeout=10000)
    time.sleep(0.3)
    print("slider to 4: label =", label(page), "| slider value =", page.locator("#page-slider").input_value())
    shot(page, "f3-03-slider")
    page.click("#btn-prev")
    page.wait_for_function("() => document.querySelector('#page-label').textContent.includes('2')", timeout=10000)
    print("prev: label =", label(page), "| slider value =", page.locator("#page-slider").input_value())
    print("JS errors:", errs if errs else "none")
    b.close()
    print("F3 LOCAL VERIFY DONE")
