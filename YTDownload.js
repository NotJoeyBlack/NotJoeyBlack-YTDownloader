#!/usr/bin/env node

// Enhanced YT Downloader with auto-updater, Puppeteer login for age-restricted videos, and yt-dlp integration

const fs          = require('fs');
const path        = require('path');
const os          = require('os');
const https       = require('https');
const inquirer    = require('inquirer');
const ProgressBar = require('progress');
const { spawn }   = require('child_process');
const puppeteer   = require('puppeteer');

const CURRENT_VERSION = '1.7.0';
const UPDATE_INFO_URL = 'https://api.github.com/repos/NotJoeyBlack/NotJoeyBlack-YTDownloader/releases/latest';

async function fetchJson(url) {
  return new Promise((res, rej) => {
    https.get(url, {
      headers: {
        'User-Agent': 'YTDownloader-Updater',
        'Accept': 'application/vnd.github.v3+json'
      }
    }, r => {
      if (r.statusCode !== 200) return rej(new Error(`HTTP ${r.statusCode}`));
      let body = '';
      r.on('data', chunk => body += chunk);
      r.on('end', () => {
        try { res(JSON.parse(body)); }
        catch (e) { rej(e); }
      });
    }).on('error', rej);
  });
}

async function checkForUpdates() {
  console.log('\n[Update] Checking for updates…');
  try {
    const info      = await fetchJson(UPDATE_INFO_URL);
    const latestTag = info.tag_name.replace(/^v/, '');
    console.log(`[Update] Latest release: v${latestTag}`);

    const isNewer = (a, b) => {
      const A = a.split('.').map(n => parseInt(n, 10) || 0);
      const B = b.split('.').map(n => parseInt(n, 10) || 0);
      for (let i = 0; i < 3; i++) {
        if (A[i] > B[i]) return true;
        if (A[i] < B[i]) return false;
      }
      return false;
    };

    if (isNewer(latestTag, CURRENT_VERSION)) {
      console.log(`⬆️  New version v${latestTag} available!`);
      const asset = info.assets.find(a => a.name.endsWith('.exe'));
      if (!asset) throw new Error('No installer asset found');

      const tmp = path.join(os.tmpdir(), asset.name);
      console.log('[Update] Downloading installer…');
      await downloadFile(asset.browser_download_url, tmp);

      console.log('\n[Update] Launching installer…');
      spawn(tmp, [], { detached: true, stdio: 'ignore' }).unref();
      process.exit(0);
    } else {
      console.log('[Update] Already on latest version.');
    }
  } catch (e) {
    console.warn('[Update] Update check failed:', e.message);
  }
}

function downloadFile(url, dest) {
  return new Promise((res, rej) => {
    const file = fs.createWriteStream(dest);
    https.get(url, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        file.close();
        return downloadFile(r.headers.location, dest).then(res).catch(rej);
      }
      if (r.statusCode !== 200) return rej(new Error(`HTTP ${r.statusCode}`));

      const total = parseInt(r.headers['content-length'], 10);
      let bar = null;
      if (!isNaN(total)) {
        bar = new ProgressBar('  downloading [:bar] :percent :etas', {
          total,
          width: 40
        });
      }
      r.on('data', chunk => bar && bar.tick(chunk.length));
      r.pipe(file);
      file.on('finish', () => file.close(res));
    }).on('error', err => {
      try { fs.unlinkSync(dest); } catch {}
      rej(err);
    });
  });
}

function waitForKeypress() {
  console.log('\nPress any key to exit...');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', () => process.exit(0));
}

async function loginAndSaveCookies(videoUrl) {
  const email    = 'notjoeyblackytdownloader@gmail.com';
  const password = 'uApjJqB9Jj';

  console.log('[Auth] Bypassing Age Restriction, This May Take 30 Seconds Or More');

  const browser = await puppeteer.launch({
    headless: 'new',  // use new headless mode
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      // disable WebAuthn / passkeys entirely:
      '--disable-features=WebAuth,WebAuthn,WebAuthenticationAPI'
    ],
    defaultViewport: null
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);

  // ――― Disable in-page WebAuthn API calls so login falls back to password
  await page.evaluateOnNewDocument(() => {
    // remove the PublicKeyCredential constructor
    window.PublicKeyCredential = undefined;
    // stub out navigator.credentials methods
    if (navigator.credentials) {
      navigator.credentials.create = () => Promise.reject(new Error('WebAuthn disabled'));
      navigator.credentials.get    = () => Promise.reject(new Error('WebAuthn disabled'));
    }
  });

  // Stealth: override webdriver and set a real user agent
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/116.0.0.0 Safari/537.36'
  );

  // Auto-dismiss any JS dialogs
  page.on('dialog', async d => { await d.dismiss().catch(() => {}); });

  // 1) Email entry
  await page.goto('https://accounts.google.com/signin/v2/identifier', { waitUntil: 'networkidle2' });
  const emailSel = await page.waitForSelector('#identifierId, input[type="email"]', { visible: true });
  await emailSel.type(email, { delay: 50 });
  await page.click('#identifierNext');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  // 2) Password entry
  const pwdSel = await page.waitForSelector('input[type="password"], input[name="Passwd"]', { visible: true });
  await pwdSel.type(password, { delay: 100 });
  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  // 3) “Stay signed in?” prompt
  const stayBtn = await page.$('#save-credential-defaults');
  if (stayBtn) {
    await stayBtn.click();
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
  }

  // 4) Dismiss any “Use your phone to sign in” or passkey banners
  try {
    const skipBtn = await page.waitForSelector('button[jsname="LgbsSe"]', { timeout: 5000 });
    await skipBtn.click();
    await page.waitForTimeout(2000);
  } catch { /* none shown */ }

  // 5) Verify login by going to YouTube homepage
  await page.goto('https://www.youtube.com/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('button#avatar-btn', { timeout: 30000 });

  // 6) Navigate to target video URL, retry if redirected
  console.log(`[Auth] Navigating to video URL to confirm age: ${videoUrl}`);
  await page.goto(videoUrl, { waitUntil: 'networkidle2' });
  if (!page.url().includes('youtube.com/watch')) {
    console.warn('[Auth] Redirected to homepage; retrying video URL');
    await page.goto(videoUrl, { waitUntil: 'networkidle2' });
  }
  await page.waitForTimeout(2000);

  // 7) Save cookies out to a Netscape-format file
  const cookies = await page.cookies();
  await browser.close();

  const netscapeLines = cookies.map(c => [
    c.domain,
    c.hostOnly ? 'FALSE' : 'TRUE',
    c.path,
    c.secure ? 'TRUE' : 'FALSE',
    c.expires && c.expires > 0 ? Math.floor(c.expires) : 0,
    c.name,
    c.value
  ].join('\t'));

  const cookieFile = path.join(os.tmpdir(), 'yt_cookies.txt');
  fs.writeFileSync(cookieFile,
    '# Netscape HTTP Cookie File\n' +
    '# Generated by NotJoeyBlack-YTDownloader\n' +
    netscapeLines.join('\n') + '\n'
  );

  console.log(`[Auth] Cookies saved to ${cookieFile}`);
  return cookieFile;
}

(async () => {
  await checkForUpdates();

  // locate yt-dlp.exe
  const exeDir = path.dirname(process.execPath);
  const ytdlp  = path.join(exeDir, 'yt-dlp.exe');
  if (!fs.existsSync(ytdlp)) {
    console.error(`❌ yt-dlp.exe not found in ${exeDir}`);
    return waitForKeypress();
  }

  // locate ffmpeg
  const ffFolder   = path.join(exeDir, 'ffmpeg-6.0-essentials_build');
  const candidates = [
    path.join(ffFolder, 'bin', 'ffmpeg.exe'),
    path.join(ffFolder, 'ffmpeg.exe')
  ];
  const ffPath = candidates.find(p => fs.existsSync(p));
  if (!ffPath) {
    console.error(`❌ ffmpeg.exe not found under ${ffFolder}`);
    return waitForKeypress();
  }
  const ffDir = path.dirname(ffPath);

  // prompt user
  const { url, choice, needsAuth } = await inquirer.prompt([
    {
      type:     'input',
      name:     'url',
      message:  'YouTube video URL:',
      validate: v => /^https?:\/\/(www\.)?youtube\.com/.test(v) || 'Invalid URL'
    },
    {
      type:    'list',
      name:    'choice',
      message: 'Format:',
      choices: [
        { name: 'Video+Audio (MP4)', value: 'v+a' },
        { name: 'Audio only',       value: 'audio' }
      ]
    },
    {
      type:    'confirm',
      name:    'needsAuth',
      message: 'Is the video age restricted?',
      default: false
    }
  ]);

  let cookieArg = [];
  if (needsAuth) {
    const cookiesFile = await loginAndSaveCookies(url);
    cookieArg = ['--cookies', cookiesFile];
  }

  // build yt-dlp args
  const fmt = choice === 'v+a'
    ? 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]'
    : 'bestaudio[ext=m4a]';
  const mergeArgs = choice === 'v+a'
    ? ['--merge-output-format', 'mp4', '--remux-video', 'mp4']
    : [];

  // ensure Downloads folder exists
  const downloadDir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const args = [
    '--no-mtime',
    '--restrict-filenames',
    ...cookieArg,
    '-f', fmt,
    ...mergeArgs,
    '--ffmpeg-location', ffDir,
    '-o', path.join(downloadDir, '%(title)s.%(ext)s'),
    url
  ];

  console.log(`\n[Download] Running: yt-dlp.exe ${args.join(' ')}`);
  const dl = spawn(ytdlp, args, { stdio: 'inherit' });
  dl.on('error', e => {
    console.error('[Download] yt-dlp failed:', e);
    waitForKeypress();
  });
  dl.on('close', code => {
    console.log(code === 0
      ? '\n✅ Download complete!'
      : `\n❌ yt-dlp exited with code ${code}`);
    spawn('explorer', [downloadDir], { shell: true });
    waitForKeypress();
  });
})();
