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

def canvases(page): return page.locator("#stage canvas").count()
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

    # Desktop spread mode
    page.goto(f"{BASE}/viewer.html?id={BOOK_ID}", wait_until="networkidle")
    page.wait_for_selector("#stage:not(.hidden)", timeout=20000)
    time.sleep(1)
    print("cover: canvases =", canvases(page), "| label =", label(page), "| prev disabled =", page.locator("#btn-prev").is_disabled(), "| next disabled =", page.locator("#btn-next").is_disabled(), "| hash =", page.evaluate("() => location.hash"))
    shot(page, "f2-01-cover")

    page.click("#btn-next")
    page.wait_for_function("() => document.querySelector('#page-label').textContent.includes('2')", timeout=10000)
    time.sleep(0.5)
    print("spread: canvases =", canvases(page), "| label =", label(page), "| hash =", page.evaluate("() => location.hash"))
    shot(page, "f2-02-spread")

    page.click("#btn-next")
    page.wait_for_function("() => document.querySelector('#page-label').textContent.includes('4 of')", timeout=10000)
    time.sleep(0.5)
    print("last: canvases =", canvases(page), "| label =", label(page), "| next disabled =", page.locator("#btn-next").is_disabled())
    shot(page, "f2-03-last")

    page.keyboard.press("ArrowLeft")
    page.wait_for_function("() => document.querySelector('#page-label').textContent.includes('2')", timeout=10000)
    print("keyboard prev: label =", label(page))
    page.keyboard.press("ArrowRight")
    page.wait_for_function("() => document.querySelector('#page-label').textContent.includes('4 of')", timeout=10000)
    print("keyboard next: label =", label(page))

    # Deep link via hash
    page.goto(f"{BASE}/viewer.html?id={BOOK_ID}#page/2", wait_until="networkidle")
    page.wait_for_selector("#stage:not(.hidden)", timeout=20000)
    time.sleep(0.5)
    print("hash #page/2: label =", label(page), "| canvases =", canvases(page))

    # Error states
    page.goto(f"{BASE}/viewer.html", wait_until="networkidle")
    time.sleep(0.5)
    print("no id: error =", page.locator("#error-text").inner_text())

    # Mobile single-page mode
    mob = b.new_page(viewport={"width": 390, "height": 844})
    mock(mob)
    mob.goto(f"{BASE}/viewer.html?id={BOOK_ID}", wait_until="networkidle")
    mob.wait_for_selector("#stage:not(.hidden)", timeout=20000)
    time.sleep(0.5)
    print("mobile cover: canvases =", canvases(mob), "| label =", label(mob))
    mob.click("#btn-next")
    mob.wait_for_function("() => document.querySelector('#page-label').textContent.includes('2 of')", timeout=10000)
    print("mobile p2: canvases =", canvases(mob), "| label =", label(mob))
    shot(mob, "f2-04-mobile")
    print("JS errors:", errs if errs else "none")
    b.close()
    print("F2 LOCAL VERIFY DONE")
