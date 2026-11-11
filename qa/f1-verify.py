import sys, time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8903"
EMAIL = "test@flipbook-reference.local"
PASSWORD = "TestFlip1234!"
PDF = "/home/hatch/workspace/reverse/heyzine/sample.pdf"
QA = "/home/hatch/workspace/flipbook-reference/qa"

def shot(page, name):
    page.screenshot(path=f"{QA}/{name}.png")
    print("shot:", name)

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
        args=["--no-sandbox", "--ignore-certificate-errors"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("console." + m.type + ": " + m.text) if m.type in ("error",) else None)

    # 1. Landing
    page.goto(BASE + "/index.html", wait_until="networkidle")
    time.sleep(1)
    print("1 landing title:", page.title())
    print("  recent status:", page.locator("#recent-status").inner_text())
    shot(page, "f1-01-landing")

    # 2. Auth: try sign up, fall back to sign in if already registered
    page.goto(BASE + "/auth.html", wait_until="networkidle")
    page.click("#tab-signup")
    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    page.click("#auth-submit")
    try:
        page.wait_for_url(BASE + "/dashboard.html", timeout=15000)
        print("2 auth: signed up, session active, on dashboard")
    except Exception:
        err = page.locator("#auth-error").inner_text()
        print("2 auth: signup did not redirect. error:", err)
        if "already registered" in err.lower() or "already" in err.lower():
            page.click("#tab-signin")
            page.fill("#email", EMAIL)
            page.fill("#password", PASSWORD)
            page.click("#auth-submit")
            try:
                page.wait_for_url(BASE + "/dashboard.html", timeout=15000)
                print("2 auth: signed in with existing test account")
            except Exception:
                print("2 auth: sign-in also failed:", page.locator("#auth-error").inner_text())
                shot(page, "f1-02-auth-failed")
                browser.close(); sys.exit(1)
        else:
            shot(page, "f1-02-auth-failed")
            browser.close(); sys.exit(1)
    shot(page, "f1-02-dashboard-signed-in")

    # 3. Upload the sample PDF
    print("  gate hidden:", page.locator("#upload-gate").is_hidden(), "| form visible:", page.locator("#upload-form").is_visible())
    page.set_input_files("#file-input", PDF)
    page.wait_for_function("() => !document.querySelector('#file-name').textContent.includes('counting')", timeout=20000)
    print("3 file picked:", page.locator("#file-name").inner_text())
    page.fill("#title", "F1 Test Book")
    page.click("#upload-btn")
    try:
        page.wait_for_selector("#upload-result:not(.hidden)", timeout=60000)
        print("3 upload: SUCCESS -", page.locator("#result-title").inner_text())
    except Exception:
        print("3 upload: FAILED -", page.locator("#upload-error").inner_text())
        shot(page, "f1-03-upload-failed")
        browser.close(); sys.exit(1)
    time.sleep(2)
    print("  list status:", page.locator("#my-status").inner_text())
    cards = page.locator("#my-grid article")
    print("  cards in list:", cards.count())
    for i in range(cards.count()):
        print("   -", cards.nth(i).locator("h3").inner_text(), "|", cards.nth(i).locator("p").inner_text())
    shot(page, "f1-03-dashboard-after-upload")
    print("JS errors:", errors if errors else "none")
    browser.close()
    print("F1 VERIFY DONE")
