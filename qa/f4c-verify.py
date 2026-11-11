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
def overlay(page): return page.locator(".flip-overlay").count()
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
    print("start: mode =", page.locator("#mode-select").input_value(), "| label =", label(page))

    # Cover -> spread 2-3 (forward flip)
    page.click("#btn-next")
    time.sleep(0.3)
    print("mid-flip 1: overlay =", overlay(page), "| card transform =",
          page.locator(".flip-card").evaluate("el => el.style.transform") if overlay(page) else "n/a")
    shot(page, "f4c-01-mid-cover")
    time.sleep(0.7)
    print("after flip 1: label =", label(page), "| overlay =", overlay(page))
    shot(page, "f4c-02-spread")

    # Spread 2-3 -> page 4 (forward flip to single page)
    page.click("#btn-next")
    time.sleep(0.3)
    shot(page, "f4c-03-mid-last")
    time.sleep(0.8)
    print("after flip 2: label =", label(page), "| overlay =", overlay(page))

    # Page 4 -> spread 2-3 (prev flip)
    page.click("#btn-prev")
    time.sleep(0.3)
    shot(page, "f4c-04-mid-prev")
    time.sleep(0.8)
    print("after flip 3: label =", label(page), "| overlay =", overlay(page))

    # Spread -> cover (prev flip to single page)
    page.click("#btn-prev")
    time.sleep(0.3)
    shot(page, "f4c-05-mid-cover-back")
    time.sleep(0.8)
    print("after flip 4: label =", label(page), "| overlay =", overlay(page))
    shot(page, "f4c-06-cover")

    print("JS errors:", errs if errs else "none")
    b.close()
    print("F4C FLIP VERIFY DONE")
