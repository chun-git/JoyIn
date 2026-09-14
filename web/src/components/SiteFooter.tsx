const INSTAGRAM_URL = 'https://www.instagram.com/joyin_technology/';
const LINE_URL = 'https://line.me/ti/p/hMNqdu_Sua';

function InstagramIcon() {
  return (
    <svg
      className="site-footer-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9zm9.75 1.25a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
      />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg
      className="site-footer-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M19.365 9.863c.349 0 .633.284.633.633 0 .349-.284.633-.633.633h-1.504v1.504c0 .349-.284.633-.633.633a.632.632 0 0 1-.633-.633v-1.504h-1.504a.632.632 0 0 1-.633-.633c0-.349.284-.633.633-.633h1.504V8.359c0-.349.284-.633.633-.633.349 0 .633.284.633.633v1.504h1.504zM12.158 9.863a.632.632 0 0 0-.633.633v3.64c0 .349.284.633.633.633.349 0 .633-.284.633-.633v-3.64a.632.632 0 0 0-.633-.633zm-3.01.04a.63.63 0 0 0-.546.316l-1.72 2.938V10.496a.632.632 0 0 0-.633-.633.632.632 0 0 0-.633.633v3.64a.632.632 0 0 0 .633.633c.228 0 .436-.122.546-.316l1.72-2.938v2.621c0 .349.284.633.633.633.349 0 .633-.284.633-.633v-3.64a.632.632 0 0 0-.633-.633zm-4.515.593v2.374H3.11a.632.632 0 0 0-.633.633c0 .349.284.633.633.633h2.156c.349 0 .633-.284.633-.633v-3.007a.632.632 0 0 0-.633-.633.632.632 0 0 0-.633.633zM12 2C6.477 2 2 5.977 2 10.889c0 4.41 3.913 8.105 9.21 8.105.34 0 .674-.012 1.004-.037.28-.021.56-.056.833-.1l2.02.994c.14.07.304.09.463.053a.73.73 0 0 0 .528-.528.74.74 0 0 0-.053-.463l-.62-1.64c1.84-1.17 3.055-2.97 3.055-4.984C18.44 5.977 16.523 2 12 2z"
      />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer" aria-label="網站頁尾">
      <div className="site-footer-inner">
        <p className="site-footer-credit">JoyIn Technology 製作</p>
        <p className="site-footer-heading">合作洽談</p>
        <ul className="site-footer-links">
          <li>
            <a
              className="site-footer-pill"
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="在 Instagram 關注 @joyin_technology（另開新分頁）"
            >
              <InstagramIcon />
              <span>@joyin_technology</span>
            </a>
          </li>
          <li>
            <a
              className="site-footer-pill"
              href={LINE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="透過 LINE 聯絡我們（另開新分頁）"
            >
              <LineIcon />
              <span>LINE 聯絡我們</span>
            </a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
