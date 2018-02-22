'use strict'

const fs = require('bluebird').Promise.promisifyAll(require('fs'))
const path = require('path')
const TVDF = require('./simple-vdf2.js')
const BVDF = require('./bvdf.js')
const {Registry} = require('rage-edit')
const SteamPaths = require('./steam-paths.js')

const home = require('os').homedir()
const arch = require('os').arch()
const platform = require('os').platform()

function SteamConfig () {
  this.rootPath = null
  this.currentUser = undefined
  this.winreg = platform === 'win32' ? new Registry('HKCU\\Software\\Valve\\Steam') : null
  this.appendToApps = false
  this.paths = new SteamPaths()

  this.appinfo = undefined
  this.config = undefined
  this.loginusers = undefined
  this.registry = undefined
  this.skins = undefined
  this.steamapps = undefined
}

SteamConfig.prototype.detectRoot = function detectRoot (autoSet = false) {
  if (typeof autoSet !== 'boolean') {
    autoSet = false
  }

  let detected

  switch (platform) {
    case 'darwin':
      detected = path.join(home, 'Library', 'Application Support', 'Steam')
      break

    case 'linux':
      detected = path.join(home, '.steam', 'steam')
      break

    case 'win32':
      if (arch === 'ia32') {
        detected = path.join('C:\\', 'Program Files (x86)', 'Steam')
      } else {
        detected = path.join('C:\\', 'Program Files', 'Steam')
      }

      if (!fs.existsSync(detected)) {
        detected = (new Registry('HKLM\\Software\\Valve\\Steam')).get('InstallPath') || undefined
      }
      break

    default:
      throw new Error(`The OS ${platform} with architecture ${arch} is not supported..`)
  }

  if (!fs.existsSync(detected)) {
    detected = undefined
  }

  if (autoSet && detected) {
    this.setRoot(detected)
  } else {
    return detected
  }
}

SteamConfig.prototype.setRoot = function setRoot (toPath) {
  if (!toPath || typeof toPath !== 'string' || toPath === '') {
    throw new Error(`${toPath} is an invalid path argument.`)
  } else if (!fs.existsSync(toPath)) {
    throw new Error(`${toPath} does not exist.`)
  } else if (!fs.existsSync(path.join(toPath, 'config', 'config.vdf')) || !fs.existsSync(path.join(toPath, 'userdata'))) {
    throw new Error(`${toPath} does not seem to be a valid Steam installation. If it's a new installation login to the client and try again.`)
  }

  this.paths.rootPath = toPath
  this.rootPath = toPath
}

SteamConfig.prototype.load = async function load (entries) {
  if (typeof entries === 'string') {
    entries = [entries]
  }

  if (typeof entries !== 'object' || entries.constructor !== Array) {
    throw new Error(`${entries} is invalid for SteamConfig.load. Should be a string, or an array of strings.`)
  }

  entries = prepareFilenames(entries)

  try {
    let data
    let tmp

    for (let entry of entries) {
      tmp = (path.extname(entry) === '' ? entry.split(/\/|\\/) : path.basename(entry, path.extname(entry)))

      if (typeof tmp === 'object') {
        tmp = tmp[tmp.length - 1]
      }

      if (tmp.indexOf('appmanifest') !== -1) {
        tmp = 'app'
      }

      switch (tmp) {
        case 'app':
          data = await TVDF.parse('' + await fs.readFileAsync(entry))
          data.library = path.dirname(entry)
          data.path = entry
          return data

        case 'appinfo':
          data = await fs.readFileAsync(entry)
          data = await BVDF.parseAppInfo(data)
          this.appinfo = afterLoad(tmp, data)
          break

        case 'localconfig':
          data = await TVDF.parse('' + await fs.readFileAsync(entry))
          this.loginusers.users[ this.paths.id64 ].localconfig = afterLoad(tmp, data)
          break

        case 'sharedconfig':
          data = await TVDF.parse('' + await fs.readFileAsync(entry))
          this.loginusers.users[ this.paths.id64 ].sharedconfig = afterLoad(tmp, data)
          break

        case 'shortcuts':
          data = await BVDF.parseShortcuts(await fs.readFileAsync(entry))
          this.loginusers.users[ this.paths.id64 ].shortcuts = afterLoad(tmp, data)
          break

        case 'skins':
          data = fs.readdirSync(entry).filter(f => {
            return f.indexOf('.txt') === -1 && f.charAt(0) !== '.'
          })
          this.skins = afterLoad(tmp, data)
          break

        case 'steamapps':
          data = fs.readdirSync(entry).filter(f => f.indexOf('.acf') !== -1)
          data = await Promise.all(data.map(async (f) => {
            tmp = '' + path.basename(f, '.acf')
            tmp = tmp.substring(tmp.indexOf('_') + 1)
            let appPath = this.paths.app(tmp, entry)
            f = this.load(appPath)
            return f
          }))
          data = afterLoad(tmp, data)
          if (this.appendToApps && this.steamapps) {
            this.steamapps.concat(data)
          } else {
            this.steamapps = data
          }
          break

        case 'config':
          data = await TVDF.parse('' + await fs.readFileAsync(entry))
          this.config = afterLoad(tmp, data)
          break

        case 'libraryfolders':
          data = await TVDF.parse('' + await fs.readFileAsync(entry))
          this.libraryfolders = afterLoad(tmp, data)
          break

        case 'loginusers':
          data = await TVDF.parse('' + await fs.readFileAsync(entry))
          this.loginusers = afterLoad(tmp, data)
          break

        case 'registry':
          if (platform === 'darwin') {
            data = '' + await fs.readFileAsync(path.join(this.paths.rootPath, 'registry.vdf'))
            data = await TVDF.parse(data)
          } else if (platform === 'linux') {
            data = '' + await fs.readFileAsync(path.join(this.paths.rootPath, '..', 'registry.vdf'))
            data = await TVDF.parse(data)
          } else if (platform === 'win32') {
            const winreg = new Registry('HKCU\\Software\\Valve\\Steam')
            data = { 'Registry': { 'HKCU': { 'Software': { 'Valve': { 'Steam': {
              'language': await winreg.get('language'),
              'RunningAppID': await winreg.get('RunningAppID'),
              'Apps': await winreg.get('Apps'),
              'AutoLoginUser': await winreg.get('AutoLoginUser'),
              'RememberPassword': await winreg.get('RememberPassword'),
              'SourceModInstallPath': await winreg.get('SourceModInstallPath'),
              'AlreadyRetriedOfflineMode': await winreg.get('AlreadyRetriedOfflineMode'),
              'StartupMode': await winreg.get('StartupMode'),
              'SkinV4': await winreg.get('SkinV4')
            }}}}}}
          }
          this.registry = data
          break

        default:
          throw new Error(`Cannot load unknown entry type ${tmp} from ${entry}.`)
      }
    }
  } catch (err) {
    throw new Error(err)
  }
}

SteamConfig.prototype.save = async function save (entries) {
  if (typeof entries === 'string') {
    entries = [entries]
  }

  if (typeof entries !== 'object' || entries.constructor !== Array) {
    throw new Error(`${entries} is invalid for SteamConfig.save. Should be a string, or an array of strings.`)
  }

  entries = prepareFilenames(entries)

  try {
    let data
    let tmp
    let tmp2

    for (let entry of entries) {
      tmp = (path.extname(entry) === '' ? entry.split(/\/|\\/) : path.basename(entry, path.extname(entry)))

      if (typeof tmp === 'object') {
        tmp = tmp[tmp.length - 1]
      }

      if (tmp.indexOf('appmanifest') !== -1) {
        tmp = 'app'
      }

      switch (tmp) {
        case 'app':
          data = await TVDF.parse('' + await fs.readFileAsync(entry))
          tmp2 = '' + entry.substring(entry.indexOf('_') + 1, entry.indexOf('.'))
          tmp = this.steamapps.filter(a => a.AppState.appid === tmp2)[ 0 ]
          if (!tmp) {
            throw new Error(`${entry} is invalid because it could not be found.`)
          }
          tmp = Object.assign(data, tmp)
          this.steamapps[ tmp2 ] = tmp
          await fs.writeFileAsync(entry, TVDF.stringify(tmp, true))
          break

        case 'config':
          data = await TVDF.parse('' + await fs.readFileAsync(entry))
          tmp = Object.assign(data, this.config)
          this.config = tmp
          await fs.writeFileAsync(entry, TVDF.stringify(tmp, true))
          break

        case 'loginusers':
          data = await TVDF.parse('' + await fs.readFileAsync(entry))
          tmp = Object.assign(data, this.loginusers)
          await fs.writeFileAsync(entry, TVDF.stringify(tmp, true))
          break

        case 'registry':
          if (platform === 'darwin') {
            data = '' + await fs.readFileAsync(path.join(this.rootPath, 'registry.vdf'))
            data = await TVDF.parse(data)
          } else if (platform === 'linux') {
            data = '' + await fs.readFileAsync(path.join(this.rootPath, '..', 'registry.vdf'))
            data = await TVDF.parse(data)
          } else if (platform === 'win32') {
            const winreg = new Registry('HKCU\\Software\\Valve\\Steam')
            data = { 'Registry': { 'HKCU': { 'Software': { 'Valve': { 'Steam': {
              'language': await winreg.get('language'),
              'RunningAppID': await winreg.get('RunningAppID'),
              'Apps': await winreg.get('Apps'),
              'AutoLoginUser': await winreg.get('AutoLoginUser'),
              'RememberPassword': await winreg.get('RememberPassword'),
              'SourceModInstallPath': await winreg.get('SourceModInstallPath'),
              'AlreadyRetriedOfflineMode': await winreg.get('AlreadyRetriedOfflineMode'),
              'StartupMode': await winreg.get('StartupMode'),
              'SkinV4': await winreg.get('SkinV4')
            }}}}}}
          }
          this.registry = data
          break

        case 'localconfig':
          data = await TVDF.parse('' + await fs.readFileAsync(entry))
          tmp = Object.assign(data, this.loginusers.users[ this.paths.id64 ].localconfig)
          this.loginusers.users[ this.paths.id64 ].localconfig = tmp
          await fs.writeFileAsync(entry, TVDF.stringify(tmp, true))
          break

        case 'sharedconfig':
          data = await TVDF.parse('' + await fs.readFileAsync(entry))
          tmp = Object.assign(data, this.loginusers.users[ this.paths.id64 ].sharedconfig)
          this.loginusers.users[ this.paths.id64 ].sharedconfig = tmp
          await fs.writeFileAsync(entry, TVDF.stringify(tmp, true))
          break

        default:
          throw new Error(`Cannot save unknown entry '${entry}'.`)
      }
    }
  } catch (err) {
    throw new Error(err)
  }
}

SteamConfig.prototype.detectUser = function detectUser () {
  let detected

  if (this.registry && this.loginusers && this.registry.Registry.HKCU.Software.Valve.Steam.AutoLoginUser !== '') {
    let tmp = this.registry.Registry.HKCU.Software.Valve.Steam.AutoLoginUser
    detected = Object.keys(this.loginusers.users).filter(k => this.loginusers.users[ k ].AccountName === tmp)[ 0 ] || undefined
  }

  if (!detected && this.loginusers) {
    let keys = Object.keys(this.loginusers.users)
    if (keys.length === 1) {
      detected = keys[ 0 ]
    } else {
      detected = keys.filter(k => this.loginusers.users[ k ].mostrecent === '1')[ 0 ] || undefined
    }
  }

  if (detected) {
    return detected
  } else {
    throw new Error('Could not detect user.')
  }
}

SteamConfig.prototype.setUser = function setUser (toUser) {
  this.currentUser = Object.keys(this.loginusers.users).filter(u => u === toUser || this.loginusers.users[ u ].accountId === toUser || this.loginusers.users[ u ].AccountName === toUser || this.loginusers.users[ u ].PersonaName === toUser)[ 0 ] || null
  if (this.currentUser === null) {
    throw new Error(`${toUser} is an invalid user identifier.`)
  }
}

SteamConfig.prototype.strip = function (name) {
  let keys
  let data

  switch (name) {
    case 'steamapps':
      data = Object.assign(this.steamapps)
      data.map(a => {
        delete a.library
        delete a.path
      })
      break

    case 'loginusers':
      data = Object.assign(this.loginusers)
      keys = Object.keys(data)
      keys.forEach(u => {
        delete data[ u ].localconfig
        delete data[ u ].sharedconfig
        delete data[ u ].shortcuts
      })
      break
  }

  return data
}

function prepareFilenames (entries) {
  let first = []
  let last = []

  for (let entry of entries) {
    if (entry === 'sharedconfig' || entry === 'localconfig' || entry === 'shortcuts') {
      last.push(entry)
    } else {
      first.push(entry)
    }
  }

  return first.concat(last)
}

function afterLoad (name, data) {
  switch (name) {
    case 'libraryfolders':
      let keys = Object.keys(data.LibraryFolders)
      for (let keyName of keys) {
        if (keyName === 'TimeNextStatsReport' || keyName === 'ContentStatsID') {
          delete data.LibraryFolders[ keyName ]
        }
      }
      break

    case 'loginusers':
      Object.keys(data.users).forEach(k => {
        data.users[ k ].id64 = k
      })
      break

    default:
      break
  }
  return data
}

module.exports = SteamConfig
