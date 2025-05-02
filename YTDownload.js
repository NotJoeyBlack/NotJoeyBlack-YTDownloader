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

const CURRENT_VERSION = '1.6.0';
const UPDATE_INFO_URL = 'https://api.github.com/repos/NotJoeyBlack/NotJoeyBlack-YTDownloader/releases/latest';

async function fetchJson(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'YTDownloader-Updater', 'Accept': 'application/vnd.github.v3+json' } }, r => {
      if (r.statusCode !== 200) return rej(new Error(`HTTP ${r.statusCode}`));
      let body = '';
      r.on('data', chunk => body += chunk);
      r.on('end', () => { try { res(JSON.parse(body)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

async function checkForUpdates() {
  console.log('\n[Update] Checking for updates…');
  try {
    const info = await fetchJson(UPDATE_INFO_URL);
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
      if (!isNaN(total)) bar = new ProgressBar('  downloading [:bar] :percent :etas', { total, width: 40 });
      r.on('data', chunk => bar && bar.tick(chunk.length));
      r.pipe(file);
      file.on('finish', () => file.close(res));
    }).on('error', err => { try { fs.unlinkSync(dest); } catch {} rej(err); });
  });
}

function waitForKeypress() {
  console.log('\nPress any key to exit...');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', () => process.exit(0));
}

/**
 * Logs into YouTube via Puppeteer, navigates to the specific video URL to confirm age,
 * then exports cookies in Netscape format.
 */
async function loginAndSaveCookies(videoUrl) {
  const email = 'notjoeyblackytdownloader@gmail.com';
  const password = 'uApjJqB9Jj';

  console.log('[Auth] Using fixed credentials to log in...');
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);

  // Google sign-in: email
  await page.goto('https://accounts.google.com/signin/v2/identifier', { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="email"]', { visible: true });
  await page.type('input[type="email"]', email, { delay: 50 });
  await page.click('#identifierNext');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  // Google sign-in: password
  await page.waitForSelector('input[type="password"]', { visible: true });
  const pwdSelector = 'input[type="password"]';
  await page.focus(pwdSelector);
  await page.click(pwdSelector, { clickCount: 3 });
  await page.keyboard.type(password, { delay: 100 });
  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  // Handle optional "Stay signed in?" prompt
  const saveBtn = await page.$('#save-credential-defaults');
  if (saveBtn) {
    await saveBtn.click();
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
  }

  // Propagate SSO cookies to youtube.com
  await page.goto('https://www.youtube.com/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('button#avatar-btn', { timeout: 30000 });

  // Navigate to the target video to confirm age
  console.log(`[Auth] Navigating to video URL to confirm age: ${videoUrl}`);
  await page.goto(videoUrl, { waitUntil: 'networkidle2' });
  await page.waitForTimeout(2000); // give time for consent overlay

  const cookies = await page.cookies();
  await browser.close();

  const headerLines = [
    '# Netscape HTTP Cookie File',
    '# Generated by NotJoeyBlack-YTDownloader'
  ];
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
  const content = headerLines.join('\n') + '\n' + netscapeLines.join('\n') + '\n';
  fs.writeFileSync(cookieFile, content);
  console.log(`[Auth] Cookies saved to ${cookieFile}`);
  return cookieFile;
}

(async () => {
  await checkForUpdates();

  const exeDir = path.dirname(process.execPath);
  const ytdlpPath = path.join(exeDir, 'yt-dlp.exe');
  if (!fs.existsSync(ytdlpPath)) {
    console.error(`❌ yt-dlp.exe not found in ${exeDir}`);
    return waitForKeypress();
  }

  const ffFolder = path.join(exeDir, 'ffmpeg-6.0-essentials_build');
  const ffCands = [path.join(ffFolder, 'bin', 'ffmpeg.exe'), path.join(ffFolder, 'ffmpeg.exe')];
  const ffPath = ffCands.find(p => fs.existsSync(p));
  if (!ffPath) {
    console.error(`❌ ffmpeg.exe not found under ${ffFolder}`);
    return waitForKeypress();
  }
  const ffFolderLoc = path.dirname(ffPath);

  // 1) Prompt for URL & decide on auth
  const { url, choice, needsAuth } = await inquirer.prompt([
    { type: 'input', name: 'url', message: 'YouTube video URL:', validate: v => /^https?:\/\/(www\.)?youtube\.com/.test(v) || 'Invalid URL' },
    { type: 'list', name: 'choice', message: 'Format:', choices: [{ name: 'Video+Audio (MP4)', value: 'v+a' }, { name: 'Audio only', value: 'audio' }] },
    { type: 'confirm', name: 'needsAuth', message: 'Login with Google to access age-restricted videos?', default: false }
  ]);

  let cookieArg = [];
  if (needsAuth) {
    const cookiesFile = await loginAndSaveCookies(url);
    cookieArg = ['--cookies', cookiesFile];
  }

  // 2) Build format args
  const fmt = choice === 'v+a'
    ? 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]'
    : 'bestaudio[ext=m4a]';
  const mergeArgs = choice === 'v+a' ? ['--merge-output-format', 'mp4', '--remux-video', 'mp4'] : [];

  // 3) Run yt-dlp
  const downloadDir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
  const args = [
    '--no-mtime', '--restrict-filenames',
    ...cookieArg,
    '-f', fmt,
    ...mergeArgs,
    '--ffmpeg-location', ffFolderLoc,
    '-o', path.join(downloadDir, '%(title)s.%(ext)s'),
    url
  ];
  console.log(`\n[Download] Running: yt-dlp.exe ${args.join(' ')}`);

  const dl = spawn(ytdlpPath, args, { stdio: 'inherit' });
  dl.on('error', e => { console.error('[Download] yt-dlp failed:', e); waitForKeypress(); });
  dl.on('close', code => {
    console.log(code === 0 ? '\n✅ Download complete!' : `\n❌ yt-dlp exited with code ${code}`);
    spawn('explorer', [downloadDir], { shell: true });
    waitForKeypress();
  });
})();
