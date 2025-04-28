#!/usr/bin/env node

const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const https     = require('https');
const semver    = require('semver');
const inquirer  = require('inquirer');
const { spawn } = require('child_process');

const CURRENT_VERSION = '1.0.0';  // ← bump this on each release, matching your Git tag
const GITHUB_API_LATEST = 'https://api.github.com/repos/YOUR_GITHUB_USERNAME/YOUR_REPO/releases/latest';
// If you hit rate-limits, set a GITHUB_TOKEN env var and add an Authorization header below.

const LAST_CHECK_DIR  = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'YTDownloader');
const LAST_CHECK_FILE = path.join(LAST_CHECK_DIR, 'last_check.txt');

function waitForKeypress() {
  console.log('\nPress any key to exit...');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', () => process.exit(0));
}

function shouldCheckForUpdate() {
  try {
    if (!fs.existsSync(LAST_CHECK_FILE)) return true;
    const last = Number(fs.readFileSync(LAST_CHECK_FILE, 'utf8'));
    return Date.now() - last > 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

function markChecked() {
  try {
    if (!fs.existsSync(LAST_CHECK_DIR)) fs.mkdirSync(LAST_CHECK_DIR, { recursive: true });
    fs.writeFileSync(LAST_CHECK_FILE, String(Date.now()));
  } catch {}
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': 'YTDownloader-Updater',
        'Accept': 'application/vnd.github.v3+json',
        // ...(process.env.GITHUB_TOKEN && { 'Authorization': `token ${process.env.GITHUB_TOKEN}` })
      }
    };
    https.get(url, opts, res => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode}`));
      }
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

async function checkForUpdates() {
  if (!shouldCheckForUpdate()) return;
  try {
    const info = await fetchJson(GITHUB_API_LATEST);
    const latestTag = info.tag_name.replace(/^v/, '');
    if (semver.gt(latestTag, CURRENT_VERSION)) {
      console.log(`⬆️  New version ${latestTag} available!`);
      const asset = info.assets.find(a => a.name.endsWith('Setup.exe'));
      if (asset) {
        const tmp = path.join(os.tmpdir(), asset.name);
        console.log('⏬ Downloading installer…');
        await downloadFile(asset.browser_download_url, tmp);
        console.log('▶️  Launching silent installer and exiting…');
        spawn(tmp, ['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART'], { detached: true, stdio: 'ignore' }).unref();
        process.exit(0);
      }
    }
  } catch (err) {
    console.warn('Update check failed:', err.message);
  } finally {
    markChecked();
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

;(async () => {
  // ─── 0) Auto-update check ───────────────────────────────────────────────
  await checkForUpdates();

  // ─── 1) Locate bundled yt-dlp & ffmpeg ─────────────────────────────────
  const exeDir     = path.dirname(process.execPath);
  const ytdlpPath  = path.join(exeDir, 'yt-dlp.exe');
  if (!fs.existsSync(ytdlpPath)) {
    console.error(`❌ Missing yt-dlp.exe in ${exeDir}`); return waitForKeypress();
  }
  const ffFolder   = path.join(exeDir, 'ffmpeg-6.0-essentials_build');
  const ffCands    = [path.join(ffFolder,'bin','ffmpeg.exe'), path.join(ffFolder,'ffmpeg.exe')];
  const ffmpegLoc  = ffCands.find(p => fs.existsSync(p)) && path.dirname(ffCands.find(p => fs.existsSync(p)));
  if (!ffmpegLoc) {
    console.error(`❌ Missing ffmpeg.exe under ${ffFolder}`); return waitForKeypress();
  }

  // ─── 2) Prep download folder ────────────────────────────────────────────
  const downloads = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(downloads)) fs.mkdirSync(downloads, { recursive: true });

  // ─── 3) Prompt user ─────────────────────────────────────────────────────
  const { url, choice } = await inquirer.prompt([
    { type:'input', name:'url', message:'Enter YouTube URL:', validate:i=>/^https?:\/\/(www\.)?youtube\.com/.test(i)||'Invalid URL' },
    { type:'list',  name:'choice', message:'Download:', choices:[
      {name:'Video+Audio (MP4)', value:'v+a'},
      {name:'Audio only',        value:'audio'}
    ]}
  ]);

  // ─── 4) Build & spawn yt-dlp ────────────────────────────────────────────
  let fmt, mergeArgs = [];
  if (choice==='v+a') {
    fmt = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]';
    mergeArgs = ['--merge-output-format','mp4'];
  } else {
    fmt = 'bestaudio[ext=m4a]/bestaudio';
  }

  const args = [
    '--restrict-filenames',
    '-f', fmt,
    ...mergeArgs,
    '--ffmpeg-location', ffmpegLoc,
    '-o', path.join(downloads, '%(title)s.%(ext)s'),
    url
  ];

  console.log(`\nRunning: yt-dlp.exe ${args.join(' ')}\n`);
  const dl = spawn(ytdlpPath, args, { stdio:'inherit' });

  dl.on('error', e => { console.error('❌ Failed to start yt-dlp.exe:', e); waitForKeypress(); });
  dl.on('close', code => {
    console.log(code===0 ? '\n✅ Download complete!' : `\n❌ yt-dlp exited ${code}`);
    spawn('explorer',[downloads],{shell:true});
    waitForKeypress();
  });
})();
