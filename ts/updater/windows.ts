// Copyright 2019-2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { dirname, join } from 'path';
import { spawn as spawnEmitter, SpawnOptions } from 'child_process';
import { readdir as readdirCallback, unlink as unlinkCallback } from 'fs';

import { app, BrowserWindow } from 'electron';
import { get as getFromConfig } from 'config';
import { gt } from 'semver';
import pify from 'pify';

import {
  checkForUpdates,
  deleteTempDir,
  downloadUpdate,
  getAutoDownloadUpdateSetting,
  getPrintableError,
  setUpdateListener,
  UpdaterInterface,
  UpdateInformationType,
} from './common';
import { LoggerType } from '../types/Logging';
import { hexToBinary, verifySignature } from './signature';
import { markShouldQuit } from '../../app/window_state';
import { DialogType } from '../types/Dialogs';

const readdir = pify(readdirCallback);
const unlink = pify(unlinkCallback);

const SECOND = 1000;
const MINUTE = SECOND * 60;
const INTERVAL = MINUTE * 30;

let fileName: string;
let version: string;
let updateFilePath: string;
let installing: boolean;
let loggerForQuitHandler: LoggerType;

export async function start(
  getMainWindow: () => BrowserWindow,
  logger: LoggerType
): Promise<UpdaterInterface> {
  logger.info('windows/start: starting checks...');

  loggerForQuitHandler = logger;
  app.once('quit', quitHandler);

  setInterval(async () => {
    try {
      await checkForUpdatesMaybeInstall(getMainWindow, logger);
    } catch (error) {
      logger.error(`windows/start: ${getPrintableError(error)}`);
    }
  }, INTERVAL);

  await deletePreviousInstallers(logger);
  await checkForUpdatesMaybeInstall(getMainWindow, logger);

  return {
    async force(): Promise<void> {
      return checkForUpdatesMaybeInstall(getMainWindow, logger, true);
    },
  };
}

async function checkForUpdatesMaybeInstall(
  getMainWindow: () => BrowserWindow,
  logger: LoggerType,
  force = false
) {
  logger.info('checkForUpdatesMaybeInstall: checking for update...');
  const result = await checkForUpdates(logger, force);
  if (!result) {
    return;
  }

  const { fileName: newFileName, version: newVersion } = result;

  setUpdateListener(createUpdater(getMainWindow, result, logger));

  if (fileName !== newFileName || !version || gt(newVersion, version)) {
    const autoDownloadUpdates = await getAutoDownloadUpdateSetting(
      getMainWindow()
    );
    if (!autoDownloadUpdates) {
      getMainWindow().webContents.send(
        'show-update-dialog',
        DialogType.DownloadReady,
        {
          downloadSize: result.size,
          version: result.version,
        }
      );
      return;
    }
    await downloadAndInstall(newFileName, newVersion, getMainWindow, logger);
  }
}

async function downloadAndInstall(
  newFileName: string,
  newVersion: string,
  getMainWindow: () => BrowserWindow,
  logger: LoggerType,
  updateOnProgress?: boolean
) {
  try {
    const oldFileName = fileName;
    const oldVersion = version;

    deleteCache(updateFilePath, logger);
    fileName = newFileName;
    version = newVersion;

    try {
      updateFilePath = await downloadUpdate(
        fileName,
        logger,
        updateOnProgress ? getMainWindow() : undefined
      );
    } catch (error) {
      // Restore state in case of download error
      fileName = oldFileName;
      version = oldVersion;
      throw error;
    }

    const publicKey = hexToBinary(getFromConfig('updatesPublicKey'));
    const verified = await verifySignature(updateFilePath, version, publicKey);
    if (!verified) {
      // Note: We don't delete the cache here, because we don't want to continually
      //   re-download the broken release. We will download it only once per launch.
      throw new Error(
        `Downloaded update did not pass signature verification (version: '${version}'; fileName: '${fileName}')`
      );
    }

    logger.info('downloadAndInstall: showing dialog...');
    getMainWindow().webContents.send('show-update-dialog', DialogType.Update, {
      version,
    });
  } catch (error) {
    logger.error(`downloadAndInstall: ${getPrintableError(error)}`);
  }
}

function quitHandler() {
  if (updateFilePath && !installing) {
    verifyAndInstall(updateFilePath, version, loggerForQuitHandler).catch(
      error => {
        loggerForQuitHandler.error(`quitHandler: ${getPrintableError(error)}`);
      }
    );
  }
}

// Helpers

// This is fixed by out new install mechanisms...
//   https://github.com/signalapp/Signal-Desktop/issues/2369
// ...but we should also clean up those old installers.
const IS_EXE = /\.exe$/i;
async function deletePreviousInstallers(logger: LoggerType) {
  const userDataPath = app.getPath('userData');
  const files: Array<string> = await readdir(userDataPath);
  await Promise.all(
    files.map(async file => {
      const isExe = IS_EXE.test(file);
      if (!isExe) {
        return;
      }

      const fullPath = join(userDataPath, file);
      try {
        await unlink(fullPath);
      } catch (error) {
        logger.error(`deletePreviousInstallers: couldn't delete file ${file}`);
      }
    })
  );
}

async function verifyAndInstall(
  filePath: string,
  newVersion: string,
  logger: LoggerType
) {
  if (installing) {
    return;
  }

  const publicKey = hexToBinary(getFromConfig('updatesPublicKey'));
  const verified = await verifySignature(updateFilePath, newVersion, publicKey);
  if (!verified) {
    throw new Error(
      `Downloaded update did not pass signature verification (version: '${newVersion}'; fileName: '${fileName}')`
    );
  }

  await install(filePath, logger);
}

async function install(filePath: string, logger: LoggerType): Promise<void> {
  logger.info('windows/install: installing package...');
  const args = ['--updated'];
  const options = {
    detached: true,
    stdio: 'ignore' as const, // TypeScript considers this a plain string without help
  };

  try {
    await spawn(filePath, args, options);
  } catch (error) {
    if (error.code === 'UNKNOWN' || error.code === 'EACCES') {
      logger.warn(
        'windows/install: Error running installer; Trying again with elevate.exe'
      );
      await spawn(getElevatePath(), [filePath, ...args], options);

      return;
    }

    throw error;
  }
}

function deleteCache(filePath: string | null, logger: LoggerType) {
  if (filePath) {
    const tempDir = dirname(filePath);
    deleteTempDir(tempDir).catch(error => {
      logger.error(`deleteCache: ${getPrintableError(error)}`);
    });
  }
}
function getElevatePath() {
  const installPath = app.getAppPath();

  return join(installPath, 'resources', 'elevate.exe');
}

async function spawn(
  exe: string,
  args: Array<string>,
  options: SpawnOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    const emitter = spawnEmitter(exe, args, options);
    emitter.on('error', reject);
    emitter.unref();

    setTimeout(resolve, 200);
  });
}

function createUpdater(
  getMainWindow: () => BrowserWindow,
  info: Pick<UpdateInformationType, 'fileName' | 'version'>,
  logger: LoggerType
) {
  return async () => {
    if (updateFilePath) {
      try {
        await verifyAndInstall(updateFilePath, version, logger);
        installing = true;
      } catch (error) {
        logger.info('createUpdater: showing general update failure dialog...');
        getMainWindow().webContents.send(
          'show-update-dialog',
          DialogType.Cannot_Update
        );

        throw error;
      }

      markShouldQuit();
      app.quit();
    } else {
      logger.info(
        'performUpdate: have not downloaded update, going to download'
      );
      await downloadAndInstall(
        info.fileName,
        info.version,
        getMainWindow,
        logger,
        true
      );
    }
  };
}
