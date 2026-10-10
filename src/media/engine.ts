import axios from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join, extname } from 'path';
import { mediaLinkFromUrl } from './sites';

const exec = promisify(execFile);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
let active = 0;
const MAX_ACTIVE = 2;
export type MediaFormat = 'mp3' | 'wav' | 'gif' | 'mp4' | 'webm' | 'mute' | 'reverse' | 'speed' | 'trim' | 'caption' | 'soundboard';
export interface ConvertOptions {
	format: MediaFormat;
	start?: number;
	duration?: number;
	speed?: number;
	caption?: string;
}
export interface ProducedMedia { filename: string; buffer: Buffer; }

const command = async (executable: string, args: string[], dir: string, timeout = 90000) =>
	exec(executable, args, { cwd: dir, timeout, maxBuffer: 1024 * 1024, windowsHide: true });

export const normalizeOptions = (format: string, start = '', duration = '', speed = '', caption = ''): ConvertOptions => {
	const valid: MediaFormat[] = ['mp3','wav','gif','mp4','webm','mute','reverse','speed','trim','caption','soundboard'];
	const requested = format.trim().toLowerCase();
	if (!valid.includes(requested as MediaFormat)) throw new Error('Geçersiz format: MP3, WAV, GIF, MP4, WEBM, mute, reverse, speed, trim, caption');
	const opts: ConvertOptions = { format: requested as MediaFormat };
	const number = (s: string, key: string, min: number, max: number): number | undefined => {
		if (!s.trim()) return undefined;
		const n = Number(s);
		if (!Number.isFinite(n) || n < min || n > max) throw new Error(key + ' ' + min + '-' + max + ' arasında olmalı.');
		return n;
	};
	opts.start = number(start, 'Başlangıç', 0, 3600);
	opts.duration = number(duration, 'Süre', 0.1, 90);
	opts.speed = number(speed, 'Hız', 0.5, 2);
	if (caption.trim()) opts.caption = caption.trim().slice(0, 140);
	if (opts.format === 'soundboard') opts.duration = Math.min(opts.duration ?? 5, 5);
	if (opts.format === 'reverse') opts.duration = Math.min(opts.duration ?? 12, 12);
	if (opts.format === 'gif') opts.duration = Math.min(opts.duration ?? 10, 10);
	if (opts.format === 'trim' && opts.duration === undefined) throw new Error('Trim işlemi için süre gir.');
	if (opts.format === 'caption' && !opts.caption) throw new Error('Caption için yazı gir.');
	return opts;
};

const isDiscordAttachment = (url: string): boolean => {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'https:' &&
			['cdn.discordapp.com', 'media.discordapp.net', 'cdn.discordapp.net'].includes(parsed.hostname);
	} catch { return false; }
};

const retrieveSource = async (url: string, dir: string): Promise<string> => {
	if (isDiscordAttachment(url)) {
		const response = await axios.get<ArrayBuffer>(url, {
			responseType: 'arraybuffer', timeout: 20000, maxContentLength: MAX_SOURCE_BYTES,
			maxRedirects: 0,
		});
		const buffer = Buffer.from(response.data);
		if (!buffer.length || buffer.length > MAX_SOURCE_BYTES) throw new Error('Dosya çok büyük veya boş.');
		const extension = /\.(mp4|webm|mov|mkv|mp3|wav|ogg|m4a|gif)(?:$|\?)/i.exec(url)?.[1]?.toLowerCase() || 'mp4';
		const target = join(dir, 'source.' + extension);
		await writeFile(target, buffer);
		return target;
	}
	// Reject arbitrary URLs (SSRF) before passing anything to a downloader.
	if (!mediaLinkFromUrl(url)) throw new Error('Bu medya bağlantısı desteklenmiyor.');
	const output = 'source.%(ext)s';
	await command(process.env.YTDLP_PATH || 'yt-dlp', [
		'--ignore-config', '--no-playlist', '--no-warnings', '--no-progress',
		'--max-filesize', '25M', '--socket-timeout', '12', '--retries', '1',
		'--fragment-retries', '1', '-f',
		'b[ext=mp4]/b/bv*[ext=mp4]+ba[ext=m4a]/bv*+ba',
		'--merge-output-format', 'mp4', '-o', output, '--', url,
	], dir);
	const items = await readdir(dir);
	const picked = items.find(x => /^source\.(mp4|webm|mkv|mov|mp3|wav|m4a|ogg)$/i.test(x));
	if (!picked) throw new Error('Bu bağlantıdan bir video indirilemedi.');
	const target = join(dir, picked);
	if ((await stat(target)).size > MAX_SOURCE_BYTES) throw new Error('Medya boyutu sınırı aşıldı.');
	return target;
};

export const runConversion = async (sourceUrl: string, options: ConvertOptions): Promise<ProducedMedia> => {
	if (active >= MAX_ACTIVE) throw new Error('Bot şu anda başka videolar işliyor. Biraz sonra tekrar dene.');
	active++;
	const dir = await mkdtemp(join(tmpdir(), 'whtba-media-'));
	try {
		const input = await retrieveSource(sourceUrl, dir);
		const kind = options.format;
		const audio = kind === 'mp3' || kind === 'wav' || kind === 'soundboard';
		const gif = kind === 'gif';
		const extension = audio ? (kind === 'wav' ? 'wav' : 'mp3') : gif ? 'gif' : kind === 'webm' ? 'webm' : 'mp4';
		const output = join(dir, 'converted.' + extension);
		const args: string[] = ['-hide_banner', '-loglevel','error','-nostdin','-y'];
		if (options.start !== undefined) args.push('-ss', String(options.start));
		args.push('-i', input);
		const duration = options.duration ?? (kind === 'soundboard' ? 5 : kind === 'gif' ? 10 : kind === 'reverse' ? 12 : undefined);
		if (duration !== undefined) args.push('-t', String(duration));
		if (audio) {
			args.push('-vn');
			if (options.speed) args.push('-af','atempo=' + options.speed);
			if (kind === 'wav') args.push('-ac','2','-ar','44100','-c:a','pcm_s16le');
			else if (kind === 'soundboard') args.push('-ac','1','-ar','48000','-b:a','96k','-c:a','libmp3lame');
			else args.push('-b:a','160k','-c:a','libmp3lame');
		} else if (gif) {
			args.push('-an', '-vf', 'fps=10,scale=320:-1:flags=lanczos', '-loop', '0');
		} else {
			const filters: string[] = [];
			if (kind === 'reverse') filters.push('reverse');
			if (options.speed) filters.push('setpts=PTS/' + options.speed);
			if (options.caption) {
				await writeFile(join(dir, 'caption.txt'), options.caption, 'utf8');
				filters.push('drawtext=textfile=caption.txt:fontcolor=white:fontsize=28:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-text_w)/2:y=h-text_h-40');
			}
			if (kind === 'webm') {
				filters.push('scale=w=min(640\,iw):h=-2');
				if (filters.length) args.push('-vf', filters.join(','));
				args.push('-c:v','libvpx-vp9','-b:v','650k','-c:a','libopus');
			} else {
				filters.push('scale=w=min(720\,iw):h=-2');
				if (filters.length) args.push('-vf', filters.join(','));
				args.push('-c:v','libx264','-preset','veryfast','-crf','29','-pix_fmt','yuv420p','-movflags','+faststart','-c:a','aac','-b:a','96k');
			}
			if (kind === 'mute') args.push('-an');
			else if (kind === 'reverse') args.push('-af','areverse');
			else if (options.speed) args.push('-af','atempo=' + options.speed);
		}
		args.push(output);
		await command(process.env.FFMPEG_PATH || 'ffmpeg', args, dir, 90000);
		const size = (await stat(output)).size;
		if (!size || size > MAX_BYTES) throw new Error('Dönüştürülen dosya 8 MiB sınırını aştı. Daha kısa bir klip seç.');
		return { filename: 'whtba-' + kind + '.' + extension, buffer: await readFile(output) };
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
		active--;
	}
};
