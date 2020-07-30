'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const binding = require('../binding.node');

const utimes = util.promisify(fs.utimes);
const stat = util.promisify(fs.stat);

/**
 * Sets the times on the specified path(s).
 *
 * @param { string|string[] } paths The path(s) to modify.
 * @param {{ btime: number, mtime: number, atime: number }} options The times to set on the path(s).
 */
async function set(paths, options) {
	const targets = normalizePaths(paths);
	const times = getFullOptions(options);
	const flags = getFlags(times);

	if (!flags || !targets.length) {
		return;
	}

	for (const target of targets) {
		// On Win32 and Darwin, use the binding to set the times
		if (process.platform === 'win32' || process.platform === 'darwin') {
			await callBinding(target, times, flags);
		}

		// On Linux, set mtime with the fs library (atime must be set as well)
		else if (flags & 2) {
			const atime = flags & 4 ? times.atime : times.mtime;
			await utimes(target, atime / 1000, times.mtime / 1000);
		}

		// On Linux, set atime without changing mtime
		else {
			const stats = await stat(target);
			const mtime = stats.mtime.getTime();
			await utimes(target, times.atime / 1000, mtime / 1000);
		}
	}
}

/**
 * Converts the given string or string array into a guaranteed array of strings.
 *
 * @param { string | string[] } paths The paths to normalize.
 * @returns { string[] }
 */
function normalizePaths(paths) {
	if (typeof paths === 'string') {
		assertPath('path', paths);
		return [ paths ];
	}

	if (Array.isArray(paths)) {
		for (let i = 0; i < paths.length; i++) {
			const path = paths[i];
			assertPath(`paths[${i}]`, path);
		}

		return paths;
	}

	throw Error('path must be a string or array');
}

/**
 * Replaces missing options with zero values.
 *
 * @param { * } options
 * @returns {{ btime: number, mtime: number, atime: number }}
 */
function getFullOptions(options) {
	if (typeof options !== 'object') {
		throw new Error('options must be an object');
	}

	assertTime('btime', options.btime);
	assertTime('mtime', options.mtime);
	assertTime('atime', options.atime);

	return {
		btime: options.btime || 0,
		mtime: options.mtime || 0,
		atime: options.atime || 0
	};
}

/**
 * Calculates the flags to send to the binding.
 *
 * @param { * } options
 * @returns { number }
 */
function getFlags(options) {
	let flags = 0;

	if (options.btime) flags |= 1;
	if (options.mtime) flags |= 2;
	if (options.atime) flags |= 4;

	return flags;
}

/**
 * Calls the binding.
 *
 * @param { string } path
 * @param {{ btime: number, mtime: number, atime: number }} times
 * @param { number } flags
 */
async function callBinding(path, times, flags) {
	return new Promise((resolve, reject) => {
		binding.utimes(pathBuffer(path), flags, times.btime, times.mtime, times.atime, result => {
			if (result !== 0) {
				return reject(new Error(`(${result}), utimes(${path})`));
			}

			resolve();
		});
	});
}

function pathBuffer(target) {
	const targetLong = path._makeLong(target);
	const buffer = Buffer.alloc(Buffer.byteLength(targetLong, 'utf-8') + 1);

	buffer.write(targetLong, 0, buffer.length - 1, 'utf-8');
	buffer[buffer.length - 1] = 0;

	if (buffer.indexOf(0) !== buffer.length - 1) {
		throw new Error('path must be a string without null bytes');
	}

	return buffer;
}

function assertPath(key, value) {
	if (typeof value !== 'string') {
		throw new Error(key + ' must be a string');
	}
	if (value.length === 0) {
		throw new Error(key + ' must not be empty');
	}
	if (value.indexOf('\u0000') !== -1) {
		throw new Error(key + ' must be a string without null bytes');
	}
}

function assertTime(key, value) {
	if (value === undefined) {
		return;
	}
	if (typeof value !== 'number') {
		throw new Error(key + ' must be a number or undefined');
	}
	if (Math.floor(value) !== value) {
		throw new Error(key + ' must be an integer');
	}
	if (value < 0) {
		throw new Error(key + ' must be a positive integer');
	}
	if (value > Math.pow(2, 48) - 1) {
		throw new Error(key + ' must not be more than ' + Math.pow(2, 48) - 1);
	}
}

module.exports = set;
module.exports.utimes = set;
module.exports.default = set;
module.exports.__esModule = true;
