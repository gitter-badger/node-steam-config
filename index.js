const fs = require('bluebird').Promise.promisifyAll(require('fs'))
const path = require('path')
const TVDF = require('simple-vdf2')
const BVDF = require('./bvdf.js')
const {Registry} = require('rage-edit')

const home = require('os').homedir()
const arch = require('os').arch()
const platform = require('os').platform()

function SteamConfig () {
  this.rootPath = null
  this.currentUser = undefined
  this.winreg = platform === 'win32' ? new Registry('HKCU\\Software\\Valve\\Steam') : null
  this.appendToApps = false

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

  this.rootPath = toPath
}

SteamConfig.prototype.getPath = function getPath (name, id, extra) {
  let entry = {
    name: name
  }

  switch (name) {
    case 'all':
      entry = [
        this.getPath('appinfo'),
        this.getPath('config'),
        this.getPath('libraryfolders'),
        this.getPath('localconfig', id, extra),
        this.getPath('loginusers'),
        this.getPath('registry'),
        this.getPath('sharedconfig', id, extra),
        this.getPath('shortcuts', id, extra),
        this.getPath('skins'),
        this.getPath('steamapps')
      ]
      break

    case 'app':
      entry.id = id
      entry.library = extra
      entry.path = path.join(extra, 'steamapps', `appmanifest_${id}.acf`)
      break

    case 'appinfo':
      entry.path = path.join(this.rootPath, 'appcache', 'appinfo.vdf')
      break

    case 'libraryfolders':
      entry.path = path.join(this.rootPath, 'steamapps', 'libraryfolders.vdf')
      break

    case 'localconfig':
    case 'shortcuts':
      entry.id64 = id
      entry.path = path.join(this.rootPath, 'userdata', extra, 'config', `${name}.vdf`)
      break

    case 'config':
    case 'loginusers':
      entry.path = path.join(this.rootPath, 'config', `${name}.vdf`)
      break

    case 'registry':
      if (platform === 'win32') {
        entry.path = 'winreg'
      } else if (platform === 'darwin') {
        entry.path = path.join(this.rootPath, 'registry.vdf')
      } else if (platform === 'linux') {
        entry.path = path.join(this.rootPath, '..', 'registry.vdf')
      }
      break

    case 'sharedconfig':
      entry.id64 = id
      entry.path = path.join(this.rootPath, 'userdata', extra, '7', 'remote', 'sharedconfig.vdf')
      break

    case 'skins':
      if (platform === 'win32' || platform === 'linux') {
        entry.path = path.join(this.rootPath, 'skins')
      } else if (platform === 'darwin') {
        entry.path = path.join(this.rootPath, 'Steam.AppBundle', 'Steam', 'Contents', 'MacOS', 'skins')
      }
      break

    case 'steamapps':
      if (extra) {
        entry.path = path.join(extra, 'steamapps')
      } else {
        entry.path = path.join(this.rootPath, 'steamapps')
      }
      break

    default:
      throw new Error(`Cannot find path to invalid argument ${name}.`)
  }

  return entry
}

SteamConfig.prototype.load = async function load (entries) {
  if (typeof entries === 'object' && entries.constructor !== Array) {
    entries = [entries]
  }

  if (typeof entries !== 'object' || entries.constructor !== Array) {
    throw new Error(`${entries} is an invalid argument to load(). Should be an 'object', or an 'array' of 'object' entries.`)
  }

  entries = beforeLoad(entries)

  try {
    let data

    for (let entry of entries) {
      switch (entry.name) {
        case 'app':
          data = await TVDF.parse('' + await fs.readFileAsync(entry.path))
          return data

        case 'appinfo':
          data = await fs.readFileAsync(entry.path)
          data = await BVDF.parseAppInfo(data)
          this.appinfo = afterLoad(entry.name, data)
          break

        case 'localconfig':
          data = await TVDF.parse('' + await fs.readFileAsync(entry.path))
          this.loginusers.users[ entry.id64 ].localconfig = afterLoad(entry.name, data)
          break

        case 'sharedconfig':
          data = await TVDF.parse('' + await fs.readFileAsync(entry.path))
          this.loginusers.users[ entry.id64 ].sharedconfig = afterLoad(entry.name, data)
          break

        case 'shortcuts':
          data = await BVDF.parseShortcuts(await fs.readFileAsync(entry.path))
          this.loginusers.users[ entry.id64 ].shortcuts = afterLoad(entry.name, data)
          break

        case 'skins':
          data = fs.readdirSync(entry.path).filter(f => {
            return f.indexOf('.txt') === -1 && f.charAt(0) !== '.'
          })
          this.skins = afterLoad(entry.name, data)
          break

        case 'steamapps':
          data = fs.readdirSync(entry.path).filter(f => f.indexOf('.acf') !== -1)
          data = await Promise.all(data.map(async (f) => {
            f = await TVDF.parse('' + await fs.readFileAsync(path.join(entry.path, f)))
            return f
          }))
          data = afterLoad(entry.name, data)
          if (this.appendToApps && this.steamapps) {
            this.steamapps.concat(data)
          } else {
            this.steamapps = data
          }
          break

        case 'config':
          data = await TVDF.parse('' + await fs.readFileAsync(entry.path))
          this.config = afterLoad(entry.name, data)
          break

        case 'libraryfolders':
          data = await TVDF.parse('' + await fs.readFileAsync(entry.path))
          this.libraryfolders = afterLoad(entry.name, data)
          break

        case 'loginusers':
          data = await TVDF.parse('' + await fs.readFileAsync(entry.path))
          this.loginusers = afterLoad(entry.name, data)
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

        default:
          throw new Error(`Cannot load unknown entry '${entry.name}'.`)
      }
    }
  } catch (err) {
    throw new Error(err)
  }
}

function beforeLoad (entries) {
  let first = []
  let last = []

  for (let entry of entries) {
    if (entry.name === 'sharedconfig' || entry.name === 'localconfig' || entry.name === 'shortcuts') {
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
      for (let key of keys) {
        if (key === 'TimeNextStatsReport' || key === 'ContentStatsID') {
          delete data.LibraryFolders[ key ]
        }
      }
      break

    default:
      break
  }
  return data
}

module.exports = SteamConfig