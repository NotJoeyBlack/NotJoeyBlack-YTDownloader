#!/usr/bin/env node

const fs         = require('fs');
const path       = require('path');
const os         = require('os');
const https      = require('https');
const inquirer   = require('inquirer');
const ProgressBar = require('progress');
const { spawn }  = require('child_process');

const CURRENT_VERSION = '1.6.0';
const UPDATE_INFO_URL = 'https://api.github.com/repos/NotJoeyBlack/NotJoeyBlack-YTDownloader/releases/latest';

function waitForKeypress() {
  console.log('\nPress any key to exit...');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', () => process.exit(0));
}

function isNewer(latest, current) {
  const a = latest.split('.').map(n => parseInt(n, 10) || 0);
  const b = current.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function fetchJson(url) {
  return new Promise((res, rej) => {
    https.get(url, {
      headers: { 'User-Agent': 'YTDownloader-Updater', 'Accept': 'application/vnd.github.v3+json' }
    }, r => {
      if (r.statusCode !== 200) return rej(new Error(`HTTP ${r.statusCode}`));
      let body = '';
      r.on('data', d => body += d);
      r.on('end', () => {
        try { res(JSON.parse(body)); }
        catch (e) { rej(e); }
      });
    }).on('error', rej);
  });
}

function downloadFile(url, dest) {
  return new Promise((res, rej) => {
    const file = fs.createWriteStream(dest);
    https.get(url, r => {
      // handle redirects
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        file.close();
        return downloadFile(r.headers.location, dest).then(res).catch(rej);
      }
      if (r.statusCode !== 200) {
        return rej(new Error(`HTTP ${r.statusCode}`));
      }

      // setup progress bar
      const total = parseInt(r.headers['content-length'], 10);
      let bar = null;
      if (!isNaN(total)) {
        bar = new ProgressBar('  downloading [:bar] :percent :etas', {
          total,
          width: 40,
          complete: '=',
          incomplete: ' '
        });
      }

      r.on('data', chunk => {
        if (bar) bar.tick(chunk.length);
      });

      r.pipe(file);
      file.on('finish', () => file.close(res));
    }).on('error', err => {
      try { fs.unlinkSync(dest); } catch {}
      rej(err);
    });
  });
}

async function checkForUpdates() {
  console.log('\n[Update] Checking for updates…');
  try {
    const info = await fetchJson(UPDATE_INFO_URL);
    const latestTag = info.tag_name.replace(/^v/, '');
    console.log(`[Update] Latest release: v${latestTag}`);

    if (isNewer(latestTag, CURRENT_VERSION)) {
      console.log(`⬆️  New version v${latestTag} available!`);
      const asset = info.assets.find(a => a.name.endsWith('.exe'));
      if (!asset) throw new Error('No installer asset found');

      const tmp = path.join(os.tmpdir(), asset.name);
      console.log('[Update] Downloading installer…');
      await downloadFile(asset.browser_download_url, tmp);

      console.log('\n[Update] Launching installer…');
      // launch with UI, no silent flags
      spawn(tmp, [], {
        detached: true,
        stdio: 'ignore'
      }).unref();

      // auto-close updater window as soon as installer starts
      process.exit(0);
    } else {
      console.log('[Update] Already on latest version.');
    }
  } catch (e) {
    console.warn('[Update] Update check failed:', e.message);
  }
}

;(async () => {
  await checkForUpdates();

  const exeDir    = path.dirname(process.execPath);
  const ytdlpPath = path.join(exeDir, 'yt-dlp.exe');
  if (!fs.existsSync(ytdlpPath)) {
    console.error(`❌ yt-dlp.exe not found in ${exeDir}`);
    return waitForKeypress();
  }

  const ffFolder = path.join(exeDir, 'ffmpeg-6.0-essentials_build');
  const ffCands  = [
    path.join(ffFolder, 'bin', 'ffmpeg.exe'),
    path.join(ffFolder, 'ffmpeg.exe')
  ];
  const found    = ffCands.find(p => fs.existsSync(p));
  const ffmpegLoc = found && path.dirname(found);
  if (!ffmpegLoc) {
    console.error(`❌ ffmpeg.exe not found under ${ffFolder}`);
    return waitForKeypress();
  }

  const downloadDir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  // 1) Prompt for URL & format
  const { url, choice } = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: 'YouTube video URL:',
      validate: v => /^https?:\/\/(www\.)?youtube\.com/.test(v) || 'Invalid URL'
    },
    {
      type: 'list',
      name: 'choice',
      message: 'Format:',
      choices: [
        {
          name: 'Video + Audio (MP4, highest-quality H.264)',
          value: 'v+a'
        },
        {
          name: 'Audio only',
          value: 'audio'
        }
      ]
    }
  ]);

  // 2) Force highest-quality MP4‐wrapped H.264 + best M4A, with MP4 fallback
  const fmt = choice === 'v+a'
    ? 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]'
    : 'bestaudio[ext=m4a]';

  const mergeArgs = [];
  if (choice === 'v+a') {
    mergeArgs.push('--merge-output-format', 'mp4');
    mergeArgs.push('--remux-video', 'mp4');
  }

  const args = [
    '--no-mtime',
    '--restrict-filenames',
    '-f', fmt,
    ...mergeArgs,
    '--ffmpeg-location', ffmpegLoc,
    '-o', path.join(downloadDir, '%(title)s.%(ext)s'),
    url
  ];

  // 3) Run yt-dlp
  console.log(`\n[Download] Running:\nyt-dlp.exe ${args.join(' ')}`);
  const dl = spawn(ytdlpPath, args, { stdio: 'inherit' });
  dl.on('error', e => {
    console.error('[Download] yt-dlp failed to start:', e);
    waitForKeypress();
  });
  dl.on('close', code => {
    console.log(
      code === 0
        ? '\n✅ Download complete!'
        : `\n❌ yt-dlp exited with code ${code}`
    );
    spawn('explorer', [downloadDir], { shell: true });
    waitForKeypress();
  });
})();
