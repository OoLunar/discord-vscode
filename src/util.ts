import { basename } from 'path';
import { TextDocument, workspace, extensions, WorkspaceConfiguration } from 'vscode';

import { KNOWN_EXTENSIONS, KNOWN_LANGUAGES } from './constants';
import type { API, GitExtension } from './git';
import { log, LogLevel } from './logger';
import GlobToRegExp from 'glob-to-regexp';
import { exec } from 'child_process';

let git: API | null | undefined;

type WorkspaceExtensionConfiguration = WorkspaceConfiguration & {
	enabled: boolean;
	detailsIdling: string;
	detailsEditing: string;
	detailsDebugging: string;
	lowerDetailsIdling: string;
	lowerDetailsEditing: string;
	lowerDetailsDebugging: string;
	lowerDetailsNoWorkspaceFound: string;
	largeImageIdling: string;
	largeImage: string;
	smallImage: string;
	suppressNotifications: boolean;
	workspaceExcludePatterns: string[];
	swapBigAndSmallImage: boolean;
	removeDetails: boolean;
	removeLowerDetails: boolean;
	removeTimestamp: boolean;
	removeRemoteRepository: boolean;
	idleTimeout: number;
	bigImageFilePaths: string[];
};

export function getConfig() {
	return workspace.getConfiguration('discord') as WorkspaceExtensionConfiguration;
}

export const toLower = (str: string) => str.toLocaleLowerCase();

export const toUpper = (str: string) => str.toLocaleUpperCase();

export const toTitle = (str: string) => toLower(str).replace(/^\w/, (c) => toUpper(c));

export async function resolveFileIconAsync(document: TextDocument): Promise<string> {
	const repoIcon = await getRepositoryIconAsync();
	if (repoIcon) {
		return repoIcon;
	}

	const filename = basename(document.fileName);
	const findKnownExtension = Object.keys(KNOWN_EXTENSIONS).find((key) => {
		if (filename.endsWith(key)) {
			return true;
		}

		const match = /^\/(.*)\/([mgiy]+)$/.exec(key);
		if (!match) {
			return false;
		}

		const regex = new RegExp(match[1], match[2]);
		return regex.test(filename);
	});
	const findKnownLanguage = KNOWN_LANGUAGES.find((key) => key.language === document.languageId);
	const fileIcon = findKnownExtension
		? KNOWN_EXTENSIONS[findKnownExtension]
		: findKnownLanguage
			? findKnownLanguage.image
			: null;

	return typeof fileIcon === 'string' ? fileIcon : fileIcon?.image ?? 'text';
}

export async function getRepositoryIconAsync(): Promise<string | undefined> {
	if (!git || git.state != 'initialized' || git.repositories.length == 0 || !workspace.workspaceFolders) {
		return;
	}

	// Get root workspace folder git repo
	let repo = git.repositories.find(repo =>
		workspace.workspaceFolders?.some(folder => repo.rootUri.path === folder.uri.path)
	);

	let branchName = repo?.state.HEAD?.name ?? repo?.state.HEAD?.commit;
	let url = repo?.state.remotes[0]?.fetchUrl;
	if (!repo || !branchName || !url) {
		return;
	}

	if (url.startsWith('git@') || url.startsWith('ssh://')) {
		url = url
			.replace('ssh://', '')
			.replace(':', '/')
			.replace('git@', 'https://')
			.replace('.git', '');
	} else {
		url = url
			.replace(/(https:\/\/)([^@]*)@(.*?$)/, '$1$3')
			.replace('.git', '');
	}

	const trackedFiles = (await execute('git ls-files', repo.rootUri.path)).trim().split('\n');
	trackedFiles.sort((a, b) => a.split('/').length - b.split('/').length);
	const regexes = getConfig().bigImageFilePaths.map(filePath => GlobToRegExp(filePath, {
		extended: true,
		globstar: true
	}));

	for (const file of trackedFiles) {
		const fileRegex = regexes.find(regex => regex.test(file));
		if (!fileRegex) {
			continue;
		}

		return url?.replace("https://", "https://raw.") + "/" + branchName + "/" + file;
	}

	return undefined;
}

/**
 * @param {string} command A shell command to execute
 * @return {Promise<string>} A promise that resolve to the output of the shell command, or an error
 * @example const output = await execute("ls -alh");
 */
function execute(command: string, cwd: string): Promise<string> {
	/**
	 * @param {Function} resolve A function that resolves the promise
	 * @param {Function} reject A function that fails the promise
	 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise
	 */
	return new Promise(function (resolve, reject) {
		/**
		 * @param {Error} error An error triggered during the execution of the childProcess.exec command
		 * @param {string|Buffer} standardOutput The result of the shell command execution
		 * @param {string|Buffer} standardError The error resulting of the shell command execution
		 * @see https://nodejs.org/api/child_process.html#child_process_child_process_exec_command_options_callback
		 */
		exec(command, {
			cwd: cwd
		}, function (error, standardOutput, standardError) {
			if (error) {
				reject();
				return;
			}

			if (standardError) {
				reject(standardError);
				return;
			}

			resolve(standardOutput);
		});
	});
}

export async function getGit() {
	if (git || git === null) {
		return git;
	}

	try {
		log(LogLevel.Debug, 'Loading git extension');
		const gitExtension = extensions.getExtension<GitExtension>('vscode.git');
		if (!gitExtension?.isActive) {
			log(LogLevel.Trace, 'Git extension not activated, activating...');
			await gitExtension?.activate();
		}
		git = gitExtension?.exports.getAPI(1);
	} catch (error) {
		git = null;
		log(LogLevel.Error, `Failed to load git extension, is git installed?; ${error as string}`);
	}

	return git;
}
