import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Chart, ChartConfiguration, Plugin, registerables } from 'chart.js';

// Renders statistics charts locally to PNG. No data leaves the machine.

Chart.register(...registerables);

const WIDTH = 1200;
const HEIGHT = 560;
const COLORS = {
	background: '#1e1f22',
	text: '#dbdee1',
	muted: '#949ba4',
	grid: 'rgba(255,255,255,0.08)',
	accent: '#5865f2',
	accentFill: 'rgba(88,101,242,0.25)',
	highlight: '#fee75c',
};

let fontsReady = false;
const fontFamily = () => {
	if (!fontsReady) {
		fontsReady = true;
		const custom = process.env.STATS_FONT_PATH;
		const candidates = [
			custom,
			'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
			'C:\\Windows\\Fonts\\segoeui.ttf',
			'C:\\Windows\\Fonts\\arial.ttf',
		].filter(Boolean) as string[];
		for (const path of candidates) {
			try {
				if (GlobalFonts.registerFromPath(path, 'WHTBA Stats')) break;
			}
			catch {
				// Try the next font; Skia falls back to any installed sans-serif font.
			}
		}
	}
	return '"WHTBA Stats", "DejaVu Sans", "Segoe UI", Arial, sans-serif';
};

const numberFormat = new Intl.NumberFormat('tr-TR');
export const formatNumber = (value: number) => numberFormat.format(value);

const background: Plugin = {
	id: 'whtba-background',
	beforeDraw: chart => {
		const { ctx } = chart;
		ctx.save();
		ctx.fillStyle = COLORS.background;
		ctx.fillRect(0, 0, chart.width, chart.height);
		ctx.restore();
	},
};

// Writes the value next to each bar when there are few enough bars to read.
const valueLabels = (horizontal: boolean): Plugin => ({
	id: 'whtba-values',
	afterDatasetsDraw: chart => {
		const meta = chart.getDatasetMeta(0);
		const data = chart.data.datasets[0]?.data as number[];
		if (!meta || !data || meta.data.length > 31) return;
		const { ctx } = chart;
		ctx.save();
		ctx.fillStyle = COLORS.text;
		ctx.font = (horizontal ? 15 : meta.data.length > 16 ? 11 : 14) + 'px ' + fontFamily();
		meta.data.forEach((element: any, index) => {
			const value = data[index];
			if (!value) return;
			const text = formatNumber(value);
			if (horizontal) {
				ctx.textAlign = 'left';
				ctx.textBaseline = 'middle';
				ctx.fillText(text, element.x + 8, element.y);
			}
			else {
				ctx.textAlign = 'center';
				ctx.textBaseline = 'bottom';
				ctx.fillText(text, element.x, element.y - 4);
			}
		});
		ctx.restore();
	},
});

const render = (config: ChartConfiguration, plugins: Plugin[]): Buffer => {
	const canvas = createCanvas(WIDTH, HEIGHT);
	const family = fontFamily();
	Chart.defaults.font.family = family;
	Chart.defaults.color = COLORS.text;
	const chart = new Chart(canvas as any, {
		...config,
		plugins: [background, ...plugins],
		options: { ...(config.options ?? {}), responsive: false, animation: false, devicePixelRatio: 1 } as any,
	});
	try {
		return canvas.toBuffer('image/png');
	}
	finally {
		chart.destroy();
	}
};

const titleOptions = (title: string, subtitle?: string) => ({
	title: { display: true, text: title, color: COLORS.text, font: { size: 24, weight: 'bold' as const }, padding: { top: 6, bottom: subtitle ? 2 : 16 } },
	subtitle: { display: Boolean(subtitle), text: subtitle ?? '', color: COLORS.muted, font: { size: 15 }, padding: { bottom: 16 } },
	legend: { display: false },
});

export interface SeriesChart {
	title: string;
	subtitle?: string;
	labels: string[];
	values: number[];
	highlightIndex?: number;
}

// Bar chart for up to ~62 buckets, filled line chart for longer series.
export const renderTimeSeries = ({ title, subtitle, labels, values, highlightIndex }: SeriesChart): Buffer => {
	const asLine = values.length > 62;
	const colors = values.map((_, index) => index === highlightIndex ? COLORS.highlight : COLORS.accent);
	return render({
		type: asLine ? 'line' : 'bar',
		data: {
			labels,
			datasets: [{
				data: values,
				backgroundColor: asLine ? COLORS.accentFill : colors,
				borderColor: COLORS.accent,
				borderWidth: asLine ? 2 : 0,
				borderRadius: asLine ? 0 : 4,
				fill: asLine,
				pointRadius: 0,
				tension: 0.25,
				maxBarThickness: 64,
			} as any],
		},
		options: {
			layout: { padding: { left: 12, right: 24, top: 8, bottom: 8 } },
			plugins: titleOptions(title, subtitle),
			scales: {
				x: { grid: { display: false }, ticks: { color: COLORS.muted, font: { size: 13 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 14 } },
				y: { beginAtZero: true, grace: '8%', grid: { color: COLORS.grid }, ticks: { color: COLORS.muted, font: { size: 13 }, precision: 0, callback: (v: any) => formatNumber(Number(v)) } },
			},
		},
	}, asLine ? [] : [valueLabels(false)]);
};

export interface RankingChart {
	title: string;
	subtitle?: string;
	labels: string[];
	values: number[];
}

export const renderRanking = ({ title, subtitle, labels, values }: RankingChart): Buffer => {
	const trimmed = labels.map(label => label.length > 26 ? label.slice(0, 25) + '…' : label);
	return render({
		type: 'bar',
		data: {
			labels: trimmed,
			datasets: [{ data: values, backgroundColor: values.map((_, i) => i === 0 ? COLORS.highlight : COLORS.accent), borderRadius: 4, maxBarThickness: 40 } as any],
		},
		options: {
			indexAxis: 'y',
			layout: { padding: { left: 12, right: 72, top: 8, bottom: 8 } },
			plugins: titleOptions(title, subtitle),
			scales: {
				x: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { color: COLORS.muted, font: { size: 13 }, precision: 0, callback: (v: any) => formatNumber(Number(v)) } },
				y: { grid: { display: false }, ticks: { color: COLORS.text, font: { size: values.length > 15 ? 13 : 15 }, autoSkip: false } },
			},
		},
	}, [valueLabels(true)]);
};
