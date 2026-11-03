"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/integrations/homeassistant/src/index.ts
var index_exports = {};
__export(index_exports, {
  createHomeAssistantIntegration: () => createHomeAssistantIntegration,
  default: () => index_default,
  homeAssistant: () => homeAssistant
});
module.exports = __toCommonJS(index_exports);

// packages/integrations-sdk/index.ts
function resourceCollection(options = {}) {
  return options;
}
function defineIntegration(definition) {
  return definition;
}

// packages/integrations/homeassistant/src/mapping.ts
var APP_IDS = {
  entities: "entities",
  lights: "lights",
  automations: "automations",
  helpers: "helpers",
  sensors: "sensors",
  scenes: "scenes",
  scripts: "scripts",
  devices: "devices",
  status: "status"
};
var HELPER_DOMAINS = /* @__PURE__ */ new Set([
  "input_boolean",
  "input_button",
  "input_datetime",
  "input_number",
  "input_select",
  "input_text",
  "counter",
  "timer"
]);
var SENSOR_DOMAINS = /* @__PURE__ */ new Set(["sensor", "binary_sensor"]);
function getDomain(entityId) {
  return entityId.split(".", 1)[0]?.toLowerCase() ?? "unknown";
}
function appsForEntity(entityId, deviceId) {
  const domain = getDomain(entityId);
  const apps = [APP_IDS.entities];
  if (domain === "light") apps.push(APP_IDS.lights);
  if (domain === "automation") apps.push(APP_IDS.automations);
  if (HELPER_DOMAINS.has(domain)) apps.push(APP_IDS.helpers);
  if (SENSOR_DOMAINS.has(domain)) apps.push(APP_IDS.sensors);
  if (domain === "scene") apps.push(APP_IDS.scenes);
  if (domain === "script") apps.push(APP_IDS.scripts);
  if (deviceId) apps.push(APP_IDS.devices);
  return apps;
}
function actionsForEntity(entityId, state) {
  const domain = getDomain(entityId);
  if (state.state === "unavailable" || state.state === "unknown") return ["openDetails"];
  const actions2 = ["openDetails"];
  if (domain === "light") {
    actions2.push("toggle", "turnOn", "turnOff");
    const modes = Array.isArray(state.attributes.supported_color_modes) ? state.attributes.supported_color_modes : [];
    if (typeof state.attributes.brightness === "number" || modes.some((mode) => mode !== "onoff")) {
      actions2.push("setBrightness");
    }
    if (modes.some((mode) => ["hs", "xy", "rgb", "rgbw", "rgbww"].includes(String(mode)))) {
      actions2.push("setColor");
    }
  } else if (["switch", "input_boolean"].includes(domain)) {
    actions2.push("toggle", "turnOn", "turnOff");
  } else if (domain === "automation") {
    actions2.push("enable", "disable", "trigger");
  } else if (domain === "input_button") {
    actions2.push("press");
  } else if (domain === "script") {
    actions2.push("execute");
  } else if (domain === "scene") {
    actions2.push("activate");
  } else if (["input_number", "input_text", "input_select", "input_datetime", "number"].includes(domain)) {
    actions2.push("setValue");
  } else if (domain === "cover") {
    actions2.push("open", "close", "stop");
  } else if (domain === "lock") {
    actions2.push("lock", "unlock");
  } else if (domain === "fan") {
    actions2.push("turnOn", "turnOff");
  } else if (domain === "climate") {
    actions2.push("setTemperature");
  } else if (domain === "timer") {
    actions2.push("start", "pause", "cancel");
  } else if (domain === "media_player") {
    actions2.push("turnOn", "turnOff");
  }
  if (domain === "counter") actions2.push("increment", "decrement", "reset");
  return actions2;
}
function mapEntity(state, registryEntry) {
  const domain = getDomain(state.entity_id);
  const name = registryEntry?.name || registryEntry?.original_name || String(state.attributes.friendly_name || state.entity_id);
  const icon = typeof state.attributes.icon === "string" ? state.attributes.icon : defaultIcon(domain);
  const apps = appsForEntity(state.entity_id, registryEntry?.device_id);
  return {
    id: state.entity_id,
    name,
    icon,
    type: domain,
    tags: [domain, ...apps, ...registryEntry?.area_id ? [`area:${registryEntry.area_id}`] : []],
    state: state.state,
    attributes: jsonObject(state.attributes),
    available: state.state !== "unavailable" && state.state !== "unknown",
    actions: actionsForEntity(state.entity_id, state),
    updatedAt: state.last_updated ?? state.last_changed,
    upstreamId: registryEntry?.unique_id,
    apps
  };
}
function jsonObject(value) {
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = jsonValue(item);
    if (normalized !== void 0) result[key] = normalized;
  }
  return result;
}
function jsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => jsonValue(item) ?? null);
  if (typeof value === "object") return jsonObject(value);
  return void 0;
}
function mapEntities(states2, registryEntries = []) {
  const registry = new Map(registryEntries.map((entry) => [entry.entity_id, entry]));
  return states2.filter((state) => !registry.get(state.entity_id)?.disabled_by).map((state) => mapEntity(state, registry.get(state.entity_id)));
}
function defaultIcon(domain) {
  const icons = {
    light: "mdi:lightbulb",
    switch: "mdi:toggle-switch",
    automation: "mdi:robot",
    sensor: "mdi:eye",
    binary_sensor: "mdi:eye",
    scene: "mdi:palette",
    script: "mdi:script-text",
    device_tracker: "mdi:account",
    climate: "mdi:thermostat"
  };
  return icons[domain] ?? "mdi:home-assistant";
}

// packages/integrations/homeassistant/src/actions.ts
var clients = /* @__PURE__ */ new WeakMap();
function attachClient(integrations, client) {
  clients.set(integrations, client);
}
function detachClient(integrations) {
  clients.delete(integrations);
}
async function stopClient(integrations) {
  const client = clients.get(integrations);
  clients.delete(integrations);
  await client?.stop();
}
function clientFor(integrations) {
  const client = clients.get(integrations);
  if (!client) throw new Error("Home Assistant connection is not running");
  return client;
}
function targetFor(resource) {
  return { entity_id: resource.id };
}
function objectInput(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  return input;
}
function isNumberTuple(value, length) {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === "number" && Number.isFinite(item));
}
async function call(integrations, resource, service, data) {
  const domain = resource.type ?? getDomain(resource.id);
  await clientFor(integrations).callService(domain, service, data, targetFor(resource));
  return { accepted: true, entityId: resource.id, service: `${domain}.${service}` };
}
var actions = {
  openDetails: {
    id: "openDetails",
    name: "Open details",
    async execute(_integrations, resource) {
      return { entityId: resource.id, domain: resource.type ?? getDomain(resource.id) };
    }
  },
  toggle: {
    id: "toggle",
    name: "Toggle",
    async execute(integrations, resource) {
      return call(integrations, resource, "toggle");
    }
  },
  turnOn: {
    id: "turnOn",
    name: "Turn on",
    async execute(integrations, resource) {
      return call(integrations, resource, "turn_on");
    }
  },
  turnOff: {
    id: "turnOff",
    name: "Turn off",
    async execute(integrations, resource) {
      return call(integrations, resource, "turn_off");
    }
  },
  setBrightness: {
    id: "setBrightness",
    name: "Set brightness",
    inputSchema: {
      type: "object",
      required: ["brightness"],
      properties: { brightness: { type: "integer", minimum: 0, maximum: 255 } },
      additionalProperties: false
    },
    async execute(integrations, resource, input) {
      const { brightness } = objectInput(input);
      if (typeof brightness !== "number" || !Number.isInteger(brightness) || brightness < 0 || brightness > 255) {
        throw new Error("Brightness must be an integer between 0 and 255");
      }
      return call(integrations, resource, "turn_on", { brightness });
    }
  },
  setColor: {
    id: "setColor",
    name: "Set color",
    inputSchema: {
      type: "object",
      properties: {
        rgb_color: { type: "array", items: { type: "integer", minimum: 0, maximum: 255 } },
        hs_color: { type: "array", items: { type: "number" } },
        color_temp_kelvin: { type: "integer", minimum: 1e3, maximum: 4e4 }
      },
      additionalProperties: false
    },
    async execute(integrations, resource, input) {
      const values = objectInput(input);
      const supported = ["rgb_color", "hs_color", "color_temp_kelvin"].filter((key) => values[key] !== void 0);
      if (supported.length !== 1) throw new Error("Provide exactly one supported color value");
      if (values.rgb_color !== void 0 && (!isNumberTuple(values.rgb_color, 3) || values.rgb_color.some((v) => !Number.isInteger(v) || v < 0 || v > 255))) {
        throw new Error("RGB color must contain three integers from 0 to 255");
      }
      if (values.hs_color !== void 0 && (!isNumberTuple(values.hs_color, 2) || values.hs_color[0] < 0 || values.hs_color[0] > 360 || values.hs_color[1] < 0 || values.hs_color[1] > 100)) {
        throw new Error("HS color must contain a hue from 0 to 360 and saturation from 0 to 100");
      }
      if (values.color_temp_kelvin !== void 0 && (typeof values.color_temp_kelvin !== "number" || !Number.isInteger(values.color_temp_kelvin) || values.color_temp_kelvin < 1e3 || values.color_temp_kelvin > 4e4)) {
        throw new Error("Color temperature must be an integer from 1000 to 40000 Kelvin");
      }
      return call(integrations, resource, "turn_on", values);
    }
  },
  enable: {
    id: "enable",
    name: "Enable",
    async execute(integrations, resource) {
      return call(integrations, resource, "turn_on");
    }
  },
  disable: {
    id: "disable",
    name: "Disable",
    async execute(integrations, resource) {
      return call(integrations, resource, "turn_off");
    }
  },
  trigger: {
    id: "trigger",
    name: "Trigger",
    async execute(integrations, resource) {
      return call(integrations, resource, "trigger");
    }
  },
  setValue: {
    id: "setValue",
    name: "Set value",
    inputSchema: {
      type: "object",
      required: ["value"],
      properties: { value: {} },
      additionalProperties: false
    },
    async execute(integrations, resource, input) {
      const { value } = objectInput(input);
      switch (resource.type ?? getDomain(resource.id)) {
        case "input_number":
          return call(integrations, resource, "set_value", { value });
        case "input_text":
          return call(integrations, resource, "set_value", { value });
        case "input_select":
          return call(integrations, resource, "select_option", { option: value });
        case "input_datetime": {
          const data = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
          if (!data.date && !data.time && !data.datetime) throw new Error("Input datetime requires date, time, or datetime");
          return call(integrations, resource, "set_datetime", data);
        }
        case "number":
          return call(integrations, resource, "set_value", { value });
        default:
          throw new Error(`Setting values is not supported for ${resource.type ?? getDomain(resource.id)}`);
      }
    }
  },
  press: {
    id: "press",
    name: "Press",
    async execute(integrations, resource) {
      return call(integrations, resource, "press");
    }
  },
  open: {
    id: "open",
    name: "Open cover",
    async execute(integrations, resource) {
      return call(integrations, resource, "open_cover");
    }
  },
  close: {
    id: "close",
    name: "Close cover",
    async execute(integrations, resource) {
      return call(integrations, resource, "close_cover");
    }
  },
  stop: {
    id: "stop",
    name: "Stop cover",
    async execute(integrations, resource) {
      return call(integrations, resource, "stop_cover");
    }
  },
  lock: {
    id: "lock",
    name: "Lock",
    async execute(integrations, resource) {
      return call(integrations, resource, "lock");
    }
  },
  unlock: {
    id: "unlock",
    name: "Unlock",
    async execute(integrations, resource) {
      return call(integrations, resource, "unlock");
    }
  },
  setTemperature: {
    id: "setTemperature",
    name: "Set target temperature",
    inputSchema: {
      type: "object",
      required: ["temperature"],
      properties: { temperature: { type: "number" } },
      additionalProperties: false
    },
    async execute(integrations, resource, input) {
      const { temperature } = objectInput(input);
      if (typeof temperature !== "number" || !Number.isFinite(temperature)) throw new Error("Temperature must be a finite number");
      return call(integrations, resource, "set_temperature", { temperature });
    }
  },
  start: {
    id: "start",
    name: "Start timer",
    async execute(integrations, resource) {
      return call(integrations, resource, "start");
    }
  },
  pause: {
    id: "pause",
    name: "Pause timer",
    async execute(integrations, resource) {
      return call(integrations, resource, "pause");
    }
  },
  cancel: {
    id: "cancel",
    name: "Cancel timer",
    async execute(integrations, resource) {
      return call(integrations, resource, "cancel");
    }
  },
  increment: {
    id: "increment",
    name: "Increment counter",
    async execute(integrations, resource) {
      return call(integrations, resource, "increment");
    }
  },
  decrement: {
    id: "decrement",
    name: "Decrement counter",
    async execute(integrations, resource) {
      return call(integrations, resource, "decrement");
    }
  },
  reset: {
    id: "reset",
    name: "Reset counter",
    async execute(integrations, resource) {
      return call(integrations, resource, "reset");
    }
  },
  execute: {
    id: "execute",
    name: "Run script",
    async execute(integrations, resource) {
      return call(integrations, resource, "turn_on");
    }
  },
  activate: {
    id: "activate",
    name: "Activate scene",
    async execute(integrations, resource) {
      return call(integrations, resource, "turn_on");
    }
  }
};

// node_modules/.bun/home-assistant-js-websocket@9.7.1/node_modules/home-assistant-js-websocket/dist/errors.js
var ERR_CANNOT_CONNECT = 1;
var ERR_INVALID_AUTH = 2;
var ERR_CONNECTION_LOST = 3;
var ERR_HASS_HOST_REQUIRED = 4;
var ERR_INVALID_HTTPS_TO_HTTP = 5;

// node_modules/.bun/home-assistant-js-websocket@9.7.1/node_modules/home-assistant-js-websocket/dist/messages.js
function auth(accessToken) {
  return {
    type: "auth",
    access_token: accessToken
  };
}
function supportedFeatures() {
  return {
    type: "supported_features",
    id: 1,
    // Always the first message after auth
    features: { coalesce_messages: 1 }
  };
}
function states() {
  return {
    type: "get_states"
  };
}
function callService(domain, service, serviceData, target, returnResponse) {
  const message = {
    type: "call_service",
    domain,
    service,
    target,
    return_response: returnResponse
  };
  if (serviceData) {
    message.service_data = serviceData;
  }
  return message;
}
function subscribeEvents(eventType) {
  const message = {
    type: "subscribe_events"
  };
  if (eventType) {
    message.event_type = eventType;
  }
  return message;
}
function unsubscribeEvents(subscription) {
  return {
    type: "unsubscribe_events",
    subscription
  };
}
function ping() {
  return {
    type: "ping"
  };
}
function error(code, message) {
  return {
    type: "result",
    success: false,
    error: {
      code,
      message
    }
  };
}

// node_modules/.bun/home-assistant-js-websocket@9.7.1/node_modules/home-assistant-js-websocket/dist/util.js
var atLeastHaVersion = (version, major, minor, patch) => {
  const [haMajor, haMinor, haPatch] = version.split(".", 3);
  return Number(haMajor) > major || Number(haMajor) === major && (patch === void 0 ? Number(haMinor) >= minor : Number(haMinor) > minor) || patch !== void 0 && Number(haMajor) === major && Number(haMinor) === minor && Number(haPatch) >= patch;
};

// node_modules/.bun/home-assistant-js-websocket@9.7.1/node_modules/home-assistant-js-websocket/dist/socket.js
var DEBUG = false;
var DEFAULT_CONNECT_TIMEOUT = 1e4;
var MSG_TYPE_AUTH_REQUIRED = "auth_required";
var MSG_TYPE_AUTH_INVALID = "auth_invalid";
var MSG_TYPE_AUTH_OK = "auth_ok";
function createSocket(options) {
  var _a;
  if (!options.auth) {
    throw ERR_HASS_HOST_REQUIRED;
  }
  const auth2 = options.auth;
  let authRefreshTask = auth2.expired ? auth2.refreshAccessToken().then(() => {
    authRefreshTask = void 0;
  }, () => {
    authRefreshTask = void 0;
  }) : void 0;
  const url = auth2.wsUrl;
  const connectTimeout = (_a = options.connectTimeout) !== null && _a !== void 0 ? _a : DEFAULT_CONNECT_TIMEOUT;
  if (DEBUG) {
    console.log("[Auth phase] Initializing", url);
  }
  function connect(triesLeft, promResolve, promReject) {
    if (DEBUG) {
      console.log("[Auth Phase] New connection", url);
    }
    const socket = new WebSocket(url);
    let invalidAuth = false;
    const connectTimer = connectTimeout > 0 ? setTimeout(() => {
      if (DEBUG) {
        console.log("[Auth phase] Connect timed out", url);
      }
      socket.close();
    }, connectTimeout) : void 0;
    const clearConnectTimer = () => {
      if (connectTimer !== void 0) {
        clearTimeout(connectTimer);
      }
    };
    const closeMessage = () => {
      clearConnectTimer();
      socket.removeEventListener("close", closeMessage);
      if (invalidAuth) {
        promReject(ERR_INVALID_AUTH);
        return;
      }
      if (triesLeft === 0) {
        promReject(ERR_CANNOT_CONNECT);
        return;
      }
      const newTries = triesLeft === -1 ? -1 : triesLeft - 1;
      setTimeout(() => connect(newTries, promResolve, promReject), 1e3);
    };
    const handleOpen = async (event) => {
      clearConnectTimer();
      try {
        if (auth2.expired) {
          await (authRefreshTask ? authRefreshTask : auth2.refreshAccessToken());
        }
        socket.send(JSON.stringify(auth(auth2.accessToken)));
      } catch (err) {
        invalidAuth = err === ERR_INVALID_AUTH;
        socket.close();
      }
    };
    const handleMessage = async (event) => {
      const message = JSON.parse(event.data);
      if (DEBUG) {
        console.log("[Auth phase] Received", message);
      }
      switch (message.type) {
        case MSG_TYPE_AUTH_INVALID:
          invalidAuth = true;
          socket.close();
          break;
        case MSG_TYPE_AUTH_OK:
          socket.removeEventListener("open", handleOpen);
          socket.removeEventListener("message", handleMessage);
          socket.removeEventListener("close", closeMessage);
          socket.removeEventListener("error", closeMessage);
          socket.haVersion = message.ha_version;
          if (atLeastHaVersion(socket.haVersion, 2022, 9)) {
            socket.send(JSON.stringify(supportedFeatures()));
          }
          promResolve(socket);
          break;
        default:
          if (DEBUG) {
            if (message.type !== MSG_TYPE_AUTH_REQUIRED) {
              console.warn("[Auth phase] Unhandled message", message);
            }
          }
      }
    };
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", closeMessage);
    socket.addEventListener("error", closeMessage);
  }
  return new Promise((resolve, reject) => connect(options.setupRetry, resolve, reject));
}

// node_modules/.bun/home-assistant-js-websocket@9.7.1/node_modules/home-assistant-js-websocket/dist/connection.js
var DEBUG2 = false;
var Connection = class {
  constructor(socket, options) {
    this._handleMessage = (event) => {
      let messageGroup = JSON.parse(event.data);
      if (!Array.isArray(messageGroup)) {
        messageGroup = [messageGroup];
      }
      messageGroup.forEach((message) => {
        if (DEBUG2) {
          console.log("Received", message);
        }
        const info = this.commands.get(message.id);
        switch (message.type) {
          case "event":
            if (info) {
              info.callback(message.event);
            } else {
              console.warn(`Received event for unknown subscription ${message.id}. Unsubscribing.`);
              this.sendMessagePromise(unsubscribeEvents(message.id)).catch((err) => {
                if (DEBUG2) {
                  console.warn(` Error unsubsribing from unknown subscription ${message.id}`, err);
                }
              });
            }
            break;
          case "result":
            if (info) {
              if (message.success) {
                info.resolve(message.result);
                if (!("subscribe" in info)) {
                  this.commands.delete(message.id);
                }
              } else {
                info.reject(message.error);
                this.commands.delete(message.id);
              }
            }
            break;
          case "pong":
            if (info) {
              info.resolve();
              this.commands.delete(message.id);
            } else {
              console.warn(`Received unknown pong response ${message.id}`);
            }
            break;
          default:
            if (DEBUG2) {
              console.warn("Unhandled message", message);
            }
        }
      });
    };
    this._handleClose = async () => {
      const oldCommands = this.commands;
      this.commandId = 1;
      this.oldSubscriptions = this.commands;
      this.commands = /* @__PURE__ */ new Map();
      this.socket = void 0;
      oldCommands.forEach((info) => {
        if (!("subscribe" in info)) {
          info.reject(error(ERR_CONNECTION_LOST, "Connection lost"));
        }
      });
      if (this.closeRequested) {
        return;
      }
      this.fireEvent("disconnected");
      const options2 = Object.assign(Object.assign({}, this.options), { setupRetry: 0 });
      const reconnect = (tries) => {
        setTimeout(async () => {
          if (this.closeRequested) {
            return;
          }
          if (DEBUG2) {
            console.log("Trying to reconnect");
          }
          try {
            const socket2 = await options2.createSocket(options2);
            this._setSocket(socket2);
          } catch (err) {
            if (this._queuedMessages) {
              const queuedMessages = this._queuedMessages;
              this._queuedMessages = void 0;
              for (const msg of queuedMessages) {
                if (msg.reject) {
                  msg.reject(ERR_CONNECTION_LOST);
                }
              }
            }
            if (err === ERR_INVALID_AUTH) {
              this.fireEvent("reconnect-error", err);
            } else {
              reconnect(tries + 1);
            }
          }
        }, Math.min(tries, 5) * 1e3);
      };
      if (this.suspendReconnectPromise) {
        await this.suspendReconnectPromise;
        this.suspendReconnectPromise = void 0;
        this._queuedMessages = [];
      }
      reconnect(0);
    };
    this.options = options;
    this.commandId = 2;
    this.commands = /* @__PURE__ */ new Map();
    this.eventListeners = /* @__PURE__ */ new Map();
    this.closeRequested = false;
    this._setSocket(socket);
  }
  get connected() {
    return this.socket !== void 0 && this.socket.readyState == this.socket.OPEN;
  }
  _setSocket(socket) {
    this.socket = socket;
    this.haVersion = socket.haVersion;
    socket.addEventListener("message", this._handleMessage);
    socket.addEventListener("close", this._handleClose);
    const oldSubscriptions = this.oldSubscriptions;
    if (oldSubscriptions) {
      this.oldSubscriptions = void 0;
      oldSubscriptions.forEach((info) => {
        if ("subscribe" in info && info.subscribe) {
          info.subscribe().then((unsub) => {
            info.unsubscribe = unsub;
            info.resolve();
          });
        }
      });
    }
    const queuedMessages = this._queuedMessages;
    if (queuedMessages) {
      this._queuedMessages = void 0;
      for (const queuedMsg of queuedMessages) {
        queuedMsg.resolve();
      }
    }
    this.fireEvent("ready");
  }
  addEventListener(eventType, callback) {
    let listeners = this.eventListeners.get(eventType);
    if (!listeners) {
      listeners = [];
      this.eventListeners.set(eventType, listeners);
    }
    listeners.push(callback);
  }
  removeEventListener(eventType, callback) {
    const listeners = this.eventListeners.get(eventType);
    if (!listeners) {
      return;
    }
    const index = listeners.indexOf(callback);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }
  fireEvent(eventType, eventData) {
    (this.eventListeners.get(eventType) || []).forEach((callback) => callback(this, eventData));
  }
  suspendReconnectUntil(suspendPromise) {
    this.suspendReconnectPromise = suspendPromise;
  }
  suspend() {
    if (!this.suspendReconnectPromise) {
      throw new Error("Suspend promise not set");
    }
    if (this.socket) {
      this.socket.close();
    }
  }
  /**
   * Reconnect the websocket connection.
   * @param force discard old socket instead of gracefully closing it.
   */
  reconnect(force = false) {
    if (!this.socket) {
      return;
    }
    if (!force) {
      this.socket.close();
      return;
    }
    this.socket.removeEventListener("message", this._handleMessage);
    this.socket.removeEventListener("close", this._handleClose);
    this.socket.close();
    this._handleClose();
  }
  close() {
    this.closeRequested = true;
    if (this.socket) {
      this.socket.close();
    }
  }
  /**
   * Subscribe to a specific or all events.
   *
   * @param callback Callback  to be called when a new event fires
   * @param eventType
   * @returns promise that resolves to an unsubscribe function
   */
  async subscribeEvents(callback, eventType) {
    return this.subscribeMessage(callback, subscribeEvents(eventType));
  }
  ping() {
    return this.sendMessagePromise(ping());
  }
  sendMessage(message, commandId) {
    if (!this.connected) {
      throw ERR_CONNECTION_LOST;
    }
    if (DEBUG2) {
      console.log("Sending", message);
    }
    if (this._queuedMessages) {
      if (commandId) {
        throw new Error("Cannot queue with commandId");
      }
      this._queuedMessages.push({ resolve: () => this.sendMessage(message) });
      return;
    }
    if (!commandId) {
      commandId = this._genCmdId();
    }
    message.id = commandId;
    this.socket.send(JSON.stringify(message));
  }
  sendMessagePromise(message) {
    return new Promise((resolve, reject) => {
      if (this._queuedMessages) {
        this._queuedMessages.push({
          reject,
          resolve: async () => {
            try {
              resolve(await this.sendMessagePromise(message));
            } catch (err) {
              reject(err);
            }
          }
        });
        return;
      }
      const commandId = this._genCmdId();
      this.commands.set(commandId, { resolve, reject });
      this.sendMessage(message, commandId);
    });
  }
  /**
   * Call a websocket command that starts a subscription on the backend.
   *
   * @param message the message to start the subscription
   * @param callback the callback to be called when a new item arrives
   * @param [options.resubscribe] re-established a subscription after a reconnect. Defaults to true.
   * @returns promise that resolves to an unsubscribe function
   */
  async subscribeMessage(callback, subscribeMessage, options) {
    if (this._queuedMessages) {
      await new Promise((resolve, reject) => {
        this._queuedMessages.push({ resolve, reject });
      });
    }
    if (options === null || options === void 0 ? void 0 : options.preCheck) {
      const precheck = await options.preCheck();
      if (!precheck) {
        throw new Error("Pre-check failed");
      }
    }
    let info;
    await new Promise((resolve, reject) => {
      const commandId = this._genCmdId();
      info = {
        resolve,
        reject,
        callback,
        subscribe: (options === null || options === void 0 ? void 0 : options.resubscribe) !== false ? () => this.subscribeMessage(callback, subscribeMessage, options) : void 0,
        unsubscribe: async () => {
          if (this.connected) {
            await this.sendMessagePromise(unsubscribeEvents(commandId));
          }
          this.commands.delete(commandId);
        }
      };
      this.commands.set(commandId, info);
      try {
        this.sendMessage(subscribeMessage, commandId);
      } catch (err) {
      }
    });
    return () => info.unsubscribe();
  }
  _genCmdId() {
    return ++this.commandId;
  }
};

// node_modules/.bun/home-assistant-js-websocket@9.7.1/node_modules/home-assistant-js-websocket/dist/auth.js
var genExpires = (expires_in) => {
  return expires_in * 1e3 + Date.now();
};
async function tokenRequest(hassUrl, clientId, data) {
  const l = typeof location !== "undefined" && location;
  if (l && l.protocol === "https:") {
    const a = document.createElement("a");
    a.href = hassUrl;
    if (a.protocol === "http:" && a.hostname !== "localhost") {
      throw ERR_INVALID_HTTPS_TO_HTTP;
    }
  }
  const formData = new FormData();
  if (clientId !== null) {
    formData.append("client_id", clientId);
  }
  Object.keys(data).forEach((key) => {
    formData.append(key, data[key]);
  });
  const resp = await fetch(`${hassUrl}/auth/token`, {
    method: "POST",
    credentials: "same-origin",
    body: formData
  });
  if (!resp.ok) {
    throw resp.status === 400 || resp.status === 403 ? ERR_INVALID_AUTH : new Error("Unable to fetch tokens");
  }
  const tokens = await resp.json();
  tokens.hassUrl = hassUrl;
  tokens.clientId = clientId;
  tokens.expires = genExpires(tokens.expires_in);
  return tokens;
}
var Auth = class {
  constructor(data, saveTokens) {
    this.data = data;
    this._saveTokens = saveTokens;
  }
  get wsUrl() {
    return `ws${this.data.hassUrl.substr(4)}/api/websocket`;
  }
  get accessToken() {
    return this.data.access_token;
  }
  get expired() {
    return Date.now() > this.data.expires;
  }
  /**
   * Refresh the access token.
   */
  async refreshAccessToken() {
    if (!this.data.refresh_token)
      throw new Error("No refresh_token");
    const data = await tokenRequest(this.data.hassUrl, this.data.clientId, {
      grant_type: "refresh_token",
      refresh_token: this.data.refresh_token
    });
    data.refresh_token = this.data.refresh_token;
    this.data = data;
    if (this._saveTokens)
      this._saveTokens(data);
  }
  /**
   * Revoke the refresh & access tokens.
   */
  async revoke() {
    if (!this.data.refresh_token)
      throw new Error("No refresh_token to revoke");
    const formData = new FormData();
    formData.append("token", this.data.refresh_token);
    await fetch(`${this.data.hassUrl}/auth/revoke`, {
      method: "POST",
      credentials: "same-origin",
      body: formData
    });
    if (this._saveTokens) {
      this._saveTokens(null);
    }
  }
};
function createLongLivedTokenAuth(hassUrl, access_token) {
  return new Auth({
    hassUrl,
    clientId: null,
    expires: Date.now() + 1e11,
    refresh_token: "",
    access_token,
    expires_in: 1e11
  });
}

// node_modules/.bun/home-assistant-js-websocket@9.7.1/node_modules/home-assistant-js-websocket/dist/store.js
var createStore = (state) => {
  let listeners = [];
  function unsubscribe(listener) {
    let out = [];
    for (let i = 0; i < listeners.length; i++) {
      if (listeners[i] === listener) {
        listener = null;
      } else {
        out.push(listeners[i]);
      }
    }
    listeners = out;
  }
  function setState(update, overwrite) {
    state = overwrite ? update : Object.assign(Object.assign({}, state), update);
    let currentListeners = listeners;
    for (let i = 0; i < currentListeners.length; i++) {
      currentListeners[i](state);
    }
  }
  return {
    get state() {
      return state;
    },
    /**
     * Create a bound copy of the given action function.
     * The bound returned function invokes action() and persists the result back to the store.
     * If the return value of `action` is a Promise, the resolved value will be used as state.
     * @param {Function} action	An action of the form `action(state, ...args) -> stateUpdate`
     * @returns {Function} boundAction()
     */
    action(action) {
      function apply(result) {
        setState(result, false);
      }
      return function() {
        let args = [state];
        for (let i = 0; i < arguments.length; i++)
          args.push(arguments[i]);
        let ret = action.apply(this, args);
        if (ret != null) {
          return ret instanceof Promise ? ret.then(apply) : apply(ret);
        }
      };
    },
    /**
     * Apply a partial state object to the current state, invoking registered listeners.
     * @param {Object} update				An object with properties to be merged into state
     * @param {Boolean} [overwrite=false]	If `true`, update will replace state instead of being merged into it
     */
    setState,
    clearState() {
      state = void 0;
    },
    /**
     * Register a listener function to be called whenever state is changed. Returns an `unsubscribe()` function.
     * @param {Function} listener	A function to call when state changes. Gets passed the new state.
     * @returns {Function} unsubscribe()
     */
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        unsubscribe(listener);
      };
    }
    // /**
    //  * Remove a previously-registered listener function.
    //  * @param {Function} listener	The callback previously passed to `subscribe()` that should be removed.
    //  * @function
    //  */
    // unsubscribe,
  };
};

// node_modules/.bun/home-assistant-js-websocket@9.7.1/node_modules/home-assistant-js-websocket/dist/collection.js
var UNSUB_GRACE_PERIOD = 5e3;
var DEBUG3 = false;
var getCollection = (conn, key, fetchCollection, subscribeUpdates2, options = { unsubGrace: true }) => {
  if (conn[key]) {
    return conn[key];
  }
  let active = 0;
  let unsubProm;
  let unsubTimer;
  let store = createStore();
  const refresh = () => {
    if (!fetchCollection) {
      throw new Error("Collection does not support refresh");
    }
    return fetchCollection(conn).then((state) => store.setState(state, true));
  };
  const refreshSwallow = () => refresh().catch((err) => {
    if (conn.connected) {
      throw err;
    }
  });
  const setupUpdateSubscription = () => {
    if (unsubTimer !== void 0) {
      if (DEBUG3) {
        console.log(`Prevented unsubscribe for ${key}`);
      }
      clearTimeout(unsubTimer);
      unsubTimer = void 0;
      return;
    }
    if (DEBUG3) {
      console.log(`Subscribing to ${key}`);
    }
    if (subscribeUpdates2) {
      unsubProm = subscribeUpdates2(conn, store);
    }
    if (fetchCollection) {
      conn.addEventListener("ready", refreshSwallow);
      refreshSwallow();
    }
    conn.addEventListener("disconnected", handleDisconnect);
  };
  const teardownUpdateSubscription = () => {
    if (DEBUG3) {
      console.log(`Unsubscribing from ${key}`);
    }
    unsubTimer = void 0;
    if (unsubProm)
      unsubProm.then((unsub) => {
        unsub();
      });
    store.clearState();
    conn.removeEventListener("ready", refresh);
    conn.removeEventListener("disconnected", handleDisconnect);
  };
  const scheduleTeardownUpdateSubscription = () => {
    if (DEBUG3) {
      console.log(`Scheduling unsubscribing from ${key}`);
    }
    unsubTimer = setTimeout(teardownUpdateSubscription, UNSUB_GRACE_PERIOD);
  };
  const handleDisconnect = () => {
    if (unsubTimer) {
      clearTimeout(unsubTimer);
      teardownUpdateSubscription();
    }
  };
  conn[key] = {
    get state() {
      return store.state;
    },
    refresh,
    subscribe(subscriber) {
      active++;
      if (DEBUG3) {
        console.log(`New subscriber for ${key}. Active subscribers: ${active}`);
      }
      if (active === 1) {
        setupUpdateSubscription();
      }
      const unsub = store.subscribe(subscriber);
      if (store.state !== void 0) {
        setTimeout(() => subscriber(store.state), 0);
      }
      return () => {
        unsub();
        active--;
        if (DEBUG3) {
          console.log(`Unsubscribe for ${key}. Active subscribers: ${active}`);
        }
        if (!active) {
          options.unsubGrace ? scheduleTeardownUpdateSubscription() : teardownUpdateSubscription();
        }
      };
    }
  };
  return conn[key];
};

// node_modules/.bun/home-assistant-js-websocket@9.7.1/node_modules/home-assistant-js-websocket/dist/commands.js
var getStates = (connection) => connection.sendMessagePromise(states());
var callService2 = (connection, domain, service, serviceData, target, returnResponse) => connection.sendMessagePromise(callService(domain, service, serviceData, target, returnResponse));

// node_modules/.bun/home-assistant-js-websocket@9.7.1/node_modules/home-assistant-js-websocket/dist/entities.js
function processEvent(store, updates, replace) {
  const state = replace ? {} : Object.assign({}, store.state);
  if (updates.a) {
    for (const entityId in updates.a) {
      const newState = updates.a[entityId];
      let last_changed = new Date(newState.lc * 1e3).toISOString();
      state[entityId] = {
        entity_id: entityId,
        state: newState.s,
        attributes: newState.a,
        context: typeof newState.c === "string" ? { id: newState.c, parent_id: null, user_id: null } : newState.c,
        last_changed,
        last_updated: newState.lu ? new Date(newState.lu * 1e3).toISOString() : last_changed
      };
    }
  }
  if (updates.r) {
    for (const entityId of updates.r) {
      delete state[entityId];
    }
  }
  if (updates.c) {
    for (const entityId in updates.c) {
      let entityState = state[entityId];
      if (!entityState) {
        console.warn("Received state update for unknown entity", entityId);
        continue;
      }
      entityState = Object.assign({}, entityState);
      const { "+": toAdd, "-": toRemove } = updates.c[entityId];
      const attributesChanged = (toAdd === null || toAdd === void 0 ? void 0 : toAdd.a) || (toRemove === null || toRemove === void 0 ? void 0 : toRemove.a);
      const attributes = attributesChanged ? Object.assign({}, entityState.attributes) : entityState.attributes;
      if (toAdd) {
        if (toAdd.s !== void 0) {
          entityState.state = toAdd.s;
        }
        if (toAdd.c) {
          if (typeof toAdd.c === "string") {
            entityState.context = Object.assign(Object.assign({}, entityState.context), { id: toAdd.c });
          } else {
            entityState.context = Object.assign(Object.assign({}, entityState.context), toAdd.c);
          }
        }
        if (toAdd.lc) {
          entityState.last_updated = entityState.last_changed = new Date(toAdd.lc * 1e3).toISOString();
        } else if (toAdd.lu) {
          entityState.last_updated = new Date(toAdd.lu * 1e3).toISOString();
        }
        if (toAdd.a) {
          Object.assign(attributes, toAdd.a);
        }
      }
      if (toRemove === null || toRemove === void 0 ? void 0 : toRemove.a) {
        for (const key of toRemove.a) {
          delete attributes[key];
        }
      }
      if (attributesChanged) {
        entityState.attributes = attributes;
      }
      state[entityId] = entityState;
    }
  }
  store.setState(state, true);
}
var subscribeUpdates = async (conn, store) => {
  let replace = true;
  const markReplace = () => {
    replace = true;
  };
  conn.addEventListener("ready", markReplace);
  try {
    const unsub = await conn.subscribeMessage((ev) => {
      processEvent(store, ev, replace);
      replace = false;
    }, {
      type: "subscribe_entities"
    });
    return () => {
      conn.removeEventListener("ready", markReplace);
      void unsub();
    };
  } catch (err) {
    conn.removeEventListener("ready", markReplace);
    throw err;
  }
};
function legacyProcessEvent(store, event) {
  const state = store.state;
  if (state === void 0)
    return;
  const { entity_id, new_state } = event.data;
  if (new_state) {
    store.setState({ [new_state.entity_id]: new_state });
  } else {
    const newEntities = Object.assign({}, state);
    delete newEntities[entity_id];
    store.setState(newEntities, true);
  }
}
async function legacyFetchEntities(conn) {
  const states2 = await getStates(conn);
  const entities = {};
  for (let i = 0; i < states2.length; i++) {
    const state = states2[i];
    entities[state.entity_id] = state;
  }
  return entities;
}
var legacySubscribeUpdates = (conn, store) => conn.subscribeEvents((ev) => legacyProcessEvent(store, ev), "state_changed");
var entitiesColl = (conn) => atLeastHaVersion(conn.haVersion, 2022, 4, 0) ? getCollection(conn, "_ent", void 0, subscribeUpdates) : getCollection(conn, "_ent", legacyFetchEntities, legacySubscribeUpdates);
var subscribeEntities = (conn, onChange) => entitiesColl(conn).subscribe(onChange);

// node_modules/.bun/home-assistant-js-websocket@9.7.1/node_modules/home-assistant-js-websocket/dist/index.js
async function createConnection(options) {
  const connOptions = Object.assign({ setupRetry: 0, createSocket }, options);
  const socket = await connOptions.createSocket(connOptions);
  const conn = new Connection(socket, connOptions);
  return conn;
}

// packages/integrations/homeassistant/src/snapshot.ts
function parseEntitySnapshot(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Home Assistant returned an invalid entity snapshot");
  }
  const states2 = [];
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`Home Assistant returned an invalid entity state for ${key}`);
    }
    const entity = item;
    if (typeof entity.entity_id !== "string" || entity.entity_id !== key || typeof entity.state !== "string" || typeof entity.attributes !== "object" || entity.attributes === null || Array.isArray(entity.attributes)) {
      throw new Error(`Home Assistant returned an incomplete entity state for ${key}`);
    }
    states2.push(entity);
  }
  return states2;
}

// packages/integrations/homeassistant/src/client.ts
var defaultHomeAssistantWebSocketApi = {
  createConnection,
  createLongLivedTokenAuth,
  getStates,
  subscribeEntities,
  callService: callService2
};
var HomeAssistantWebSocketClient = class {
  constructor(url, token, snapshotTimeoutMs = 3e4, api = defaultHomeAssistantWebSocketApi, connectWebSocket) {
    this.url = url;
    this.token = token;
    this.snapshotTimeoutMs = snapshotTimeoutMs;
    this.api = api;
    this.connectWebSocket = connectWebSocket;
    this.unsubscribeEvents = [];
    this.listeners = /* @__PURE__ */ new Set();
    this.stopped = false;
    this.registryCache = {};
    this.handleReady = () => {
      if (!this.stopped) this.emit("ready");
    };
    this.handleDisconnect = () => {
      if (!this.stopped) this.emit("disconnected");
    };
    this.handleReconnectError = () => {
      if (!this.stopped) this.emit("error");
    };
  }
  async start(onSnapshot) {
    if (this.connection) throw new Error("Home Assistant client already started");
    const url = normalizeHomeAssistantUrl(this.url);
    if (!this.token.trim()) throw new Error("Home Assistant access token is required");
    this.stopped = false;
    this.snapshotHandler = onSnapshot;
    const auth2 = this.api.createLongLivedTokenAuth(url, this.token);
    const connectWebSocket = this.connectWebSocket;
    const connection = await this.api.createConnection({
      auth: auth2,
      setupRetry: 2,
      connectTimeout: 1e4,
      ...connectWebSocket ? { createSocket: (options) => createAuthenticatedSocket(options, connectWebSocket) } : {}
    });
    this.connection = connection;
    connection.addEventListener("ready", this.handleReady);
    connection.addEventListener("disconnected", this.handleDisconnect);
    connection.addEventListener("reconnect-error", this.handleReconnectError);
    const registries = await this.refreshRegistries();
    await this.waitForFirstSnapshot(connection, registries, onSnapshot);
  }
  async stop() {
    this.stopped = true;
    this.connection?.removeEventListener("ready", this.handleReady);
    this.connection?.removeEventListener("disconnected", this.handleDisconnect);
    this.connection?.removeEventListener("reconnect-error", this.handleReconnectError);
    this.listeners.clear();
    this.unsubscribeEntities?.();
    this.unsubscribeEntities = void 0;
    await Promise.allSettled(this.unsubscribeEvents.splice(0).map((unsubscribe) => unsubscribe()));
    const connection = this.connection;
    this.connection = void 0;
    this.snapshotHandler = void 0;
    this.registryRefresh = void 0;
    connection?.close();
  }
  async callService(domain, service, serviceData, target) {
    if (!this.connection || this.stopped) throw new Error("Home Assistant is not connected");
    return this.api.callService(this.connection, domain, service, serviceData, target);
  }
  async refreshRegistries() {
    const connection = this.connection;
    if (!connection || this.stopped) throw new Error("Home Assistant is not connected");
    const commands = [
      ["entities", "config/entity_registry/list"],
      ["devices", "config/device_registry/list"],
      ["areas", "config/area_registry/list"]
    ];
    const results = await Promise.all(commands.map(async ([key, command]) => {
      try {
        const value = await commandArray(connection, command);
        if (key === "entities") this.registryCache.entities = value;
        if (key === "devices") this.registryCache.devices = value;
        if (key === "areas") this.registryCache.areas = value;
        return void 0;
      } catch (error2) {
        return `${command}: ${error2 instanceof Error ? error2.message : "request failed"}`;
      }
    }));
    const registryErrors = results.filter((error2) => Boolean(error2));
    return { ...this.registryCache, ...registryErrors.length ? { registryErrors } : {} };
  }
  async refreshDiscovery() {
    if (this.registryRefresh) return this.registryRefresh;
    const connection = this.connection;
    const snapshotHandler = this.snapshotHandler;
    if (!connection || !snapshotHandler || this.stopped) throw new Error("Home Assistant discovery is not active");
    this.registryRefresh = (async () => {
      const [registries, states2] = await Promise.all([
        this.refreshRegistries(),
        this.api.getStates(connection)
      ]);
      if (!Array.isArray(states2)) throw new Error("Home Assistant returned an invalid state snapshot");
      await snapshotHandler(states2, registries);
    })();
    try {
      await this.registryRefresh;
    } finally {
      this.registryRefresh = void 0;
    }
  }
  onConnectionChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async subscribeEvent(eventType, listener) {
    if (!this.connection || this.stopped) throw new Error("Home Assistant is not connected");
    const unsubscribe = await this.connection.subscribeEvents(listener, eventType);
    this.unsubscribeEvents.push(unsubscribe);
    return async () => {
      const index = this.unsubscribeEvents.indexOf(unsubscribe);
      if (index !== -1) this.unsubscribeEvents.splice(index, 1);
      await unsubscribe();
    };
  }
  async waitForFirstSnapshot(connection, registries, onSnapshot) {
    let settled = false;
    let unsubscribe;
    let timeout;
    try {
      await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for Home Assistant entity snapshot")), this.snapshotTimeoutMs);
        try {
          unsubscribe = this.api.subscribeEntities(connection, (snapshot) => {
            let states2;
            try {
              states2 = parseEntitySnapshot(snapshot);
            } catch (error2) {
              if (settled) return;
              settled = true;
              if (timeout) clearTimeout(timeout);
              reject(error2);
              return;
            }
            void onSnapshot(states2, registries).then(() => {
              if (settled) return;
              settled = true;
              if (timeout) clearTimeout(timeout);
              resolve();
            }).catch((error2) => {
              if (settled) return;
              settled = true;
              if (timeout) clearTimeout(timeout);
              reject(error2);
            });
          });
        } catch (error2) {
          reject(error2);
        }
      });
      this.unsubscribeEntities = unsubscribe;
    } catch (error2) {
      unsubscribe?.();
      throw error2;
    }
  }
  emit(state) {
    for (const listener of this.listeners) listener(state);
  }
};
async function createAuthenticatedSocket(options, connectWebSocket) {
  const auth2 = options.auth;
  if (!auth2) throw new Error("Home Assistant authentication is required");
  const timeoutMs = options.connectTimeout ?? 1e4;
  let retriesLeft = options.setupRetry;
  for (; ; ) {
    let socket;
    try {
      socket = await connectWebSocket(auth2.wsUrl);
      if (auth2.expired) await auth2.refreshAccessToken();
      const haVersion = await waitForAuthResult(socket, timeoutMs, auth2.accessToken);
      Object.assign(socket, { haVersion });
      if (supportsCoalescedMessages(haVersion)) {
        socket.send(JSON.stringify({ type: "supported_features", id: 1, features: { coalesce_messages: 1 } }));
      }
      return socket;
    } catch (error2) {
      socket?.close();
      if (error2 instanceof InvalidHomeAssistantAuthError || retriesLeft === 0) throw error2;
      if (retriesLeft > 0) retriesLeft -= 1;
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    }
  }
}
var InvalidHomeAssistantAuthError = class extends Error {
};
function waitForAuthResult(socket, timeoutMs, accessToken) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for Home Assistant authentication"));
    }, timeoutMs);
    const onMessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        cleanup();
        reject(new Error("Home Assistant sent an invalid authentication response"));
        return;
      }
      if (message.type === "auth_required") return;
      if (message.type === "auth_invalid") {
        cleanup();
        reject(new InvalidHomeAssistantAuthError("Home Assistant rejected the access token"));
        return;
      }
      if (message.type !== "auth_ok" || typeof message.ha_version !== "string") return;
      cleanup();
      resolve(message.ha_version);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Home Assistant closed the socket during authentication"));
    };
    const onError = () => {
      cleanup();
      reject(new Error("Home Assistant socket failed during authentication"));
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose, { once: true });
    socket.addEventListener("error", onError, { once: true });
    try {
      socket.send(JSON.stringify({ type: "auth", access_token: accessToken }));
    } catch (error2) {
      cleanup();
      reject(error2);
    }
  });
}
function supportsCoalescedMessages(version) {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 2022 || major === 2022 && minor >= 9;
}
async function commandArray(connection, type) {
  const result = await connection.sendMessagePromise({ type });
  if (!Array.isArray(result)) throw new Error(`Home Assistant returned an invalid ${type} response`);
  return result;
}
function normalizeHomeAssistantUrl(value) {
  const parsed = new URL(value.trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Home Assistant URL must use http or https");
  }
  if (parsed.username || parsed.password) throw new Error("Credentials must not be embedded in the Home Assistant URL");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

// packages/integrations/homeassistant/src/status.ts
var STATUS_RESOURCE_IDS = {
  connection: "connection",
  lightsOn: "lights-on"
};
function countLightsOn(entities) {
  return entities.filter((entity) => entity.apps.includes(APP_IDS.lights) && entity.state === "on").length;
}
function buildStatusResources(input) {
  const connected = input.connection === "connected";
  return [
    {
      id: STATUS_RESOURCE_IDS.connection,
      name: "Home Assistant connection",
      icon: connected ? "mdi:lan-connect" : "mdi:lan-disconnect",
      type: "connection-status",
      state: input.connection,
      attributes: { connected, lastUpdated: input.updatedAt },
      available: true,
      apps: [APP_IDS.status],
      updatedAt: input.updatedAt
    },
    {
      id: STATUS_RESOURCE_IDS.lightsOn,
      name: "Lights on",
      icon: "mdi:lightbulb-on",
      type: "lights-on-count",
      state: input.lightsOn,
      attributes: { count: input.lightsOn },
      available: input.hasSnapshot && connected,
      apps: [APP_IDS.status],
      updatedAt: input.updatedAt
    }
  ];
}

// packages/integrations/homeassistant/src/index.ts
var entityCollection = resourceCollection({
  persistent: true,
  shortcuts: true,
  apps: Object.values(APP_IDS).filter((appId) => appId !== APP_IDS.status)
});
var statusCollection = resourceCollection({
  persistent: true,
  shortcuts: true,
  apps: [APP_IDS.status]
});
function buildAppContributions() {
  return [
    { id: APP_IDS.entities, name: "Home Assistant Entities", icon: "mdi:home-assistant" },
    { id: APP_IDS.lights, name: "Home Assistant Lights", icon: "mdi:lightbulb" },
    { id: APP_IDS.automations, name: "Home Assistant Automations", icon: "mdi:robot" },
    { id: APP_IDS.helpers, name: "Home Assistant Helpers", icon: "mdi:form-select" },
    { id: APP_IDS.sensors, name: "Home Assistant Sensors", icon: "mdi:eye" },
    { id: APP_IDS.scenes, name: "Home Assistant Scenes", icon: "mdi:palette" },
    { id: APP_IDS.scripts, name: "Home Assistant Scripts", icon: "mdi:script-text" },
    { id: APP_IDS.devices, name: "Home Assistant Devices", icon: "mdi:devices" },
    { id: APP_IDS.status, name: "Home Assistant Status", icon: "mdi:heart-pulse" }
  ];
}
var actionDefinitions = actions;
var statusPublishers = /* @__PURE__ */ new WeakMap();
var entityListConfig = {
  selectedEntities: {
    type: "shortcut-select",
    label: "Entities",
    description: "Choose Home Assistant entities to display.",
    multiple: true,
    appIds: [APP_IDS.entities]
  }
};
var entityListWidget = {
  id: "entity-list",
  name: "Home Assistant Entity List",
  description: "Show selected entities and their current state.",
  template: "vertical-list",
  properties: {
    header: { title: "Home Assistant entities", icon: "mdi:home-assistant" },
    list: {
      iterate_over: "entities",
      max_items: 20,
      prototype: { title: "${name}", subtitle: "${state}", icon: "${icon}" }
    }
  },
  exampleProps: {
    entities: [
      { name: "Kitchen light", state: "on", icon: "mdi:lightbulb" },
      { name: "Hall temperature", state: "21.5", icon: "mdi:thermometer" }
    ]
  },
  configSchema: entityListConfig,
  resourceBindings: {
    entities: { type: "shortcut-select", configKey: "selectedEntities" }
  }
};
var sensorOverviewConfig = {
  sensors: {
    type: "shortcut-select",
    label: "Sensors",
    description: "Choose sensors to display.",
    multiple: true,
    appIds: [APP_IDS.sensors]
  }
};
var sensorOverviewWidget = {
  id: "sensor-overview",
  name: "Home Assistant Sensor Overview",
  description: "Show the latest values from selected sensors.",
  template: "vertical-list",
  properties: {
    header: { title: "Home Assistant sensors", icon: "mdi:eye" },
    list: {
      iterate_over: "sensors",
      max_items: 20,
      prototype: { title: "${name}", subtitle: "${state}", icon: "${icon}" }
    }
  },
  exampleProps: {
    sensors: [
      { name: "Living room temperature", state: "21.5", icon: "mdi:thermometer" },
      { name: "Humidity", state: "46", icon: "mdi:water-percent" }
    ]
  },
  configSchema: sensorOverviewConfig,
  resourceBindings: {
    sensors: { type: "shortcut-select", configKey: "sensors" }
  }
};
var sensorGlanceableConfig = {
  sensor: {
    type: "shortcut-select",
    label: "Sensor",
    appIds: [APP_IDS.sensors]
  }
};
var sensorValueGlanceable = {
  id: "sensor-value",
  name: "Home Assistant Sensor Value",
  icon: { file: "${sensor.icon}", size: 16, description: "Selected Home Assistant sensor" },
  text: "${sensor.name}: ${sensor.state}",
  columns: [{ icon: "${sensor.icon}", text: "${sensor.state}", format: "text" }],
  properties: { label: "${sensor.name}", value: "${sensor.state}" },
  exampleProps: { sensor: { name: "Living room temperature", state: "21.5", icon: "mdi:thermometer" } },
  configSchema: sensorGlanceableConfig,
  resourceBindings: {
    sensor: { type: "shortcut-select", configKey: "sensor" }
  }
};
var connectionStatusConfig = {
  connectionStatus: {
    type: "shortcut-select",
    label: "Connection status resource",
    required: true,
    default: STATUS_RESOURCE_IDS.connection,
    appIds: [APP_IDS.status],
    collectionIds: ["status"]
  }
};
var connectionStatusGlanceable = {
  id: "connection-status",
  name: "Home Assistant Connection",
  icon: { file: "${connection.icon}", size: 16, description: "Home Assistant connection" },
  text: "${connection.state}",
  columns: [{ icon: "${connection.icon}", text: "${connection.state}", format: "text" }],
  properties: { label: "Connection", value: "${connection.state}" },
  exampleProps: { connection: { state: "connected", icon: "mdi:lan-connect" } },
  configSchema: connectionStatusConfig,
  resourceBindings: {
    connection: { type: "shortcut-select", configKey: "connectionStatus" }
  }
};
var lightsOnConfig = {
  lightsOn: {
    type: "shortcut-select",
    label: "Lights on resource",
    required: true,
    default: STATUS_RESOURCE_IDS.lightsOn,
    appIds: [APP_IDS.status],
    collectionIds: ["status"]
  }
};
var lightsOnGlanceable = {
  id: "lights-on-count",
  name: "Home Assistant Lights On",
  icon: { file: "${lightsOn.icon}", size: 16, description: "Home Assistant lights currently on" },
  text: "${lightsOn.state} lights on",
  columns: [{ icon: "${lightsOn.icon}", text: "${lightsOn.state}", format: "number" }],
  properties: { label: "Lights on", value: "${lightsOn.state}" },
  exampleProps: { lightsOn: { state: 2, icon: "mdi:lightbulb-on" } },
  configSchema: lightsOnConfig,
  resourceBindings: {
    lightsOn: { type: "shortcut-select", configKey: "lightsOn" }
  }
};
function activityError(error2) {
  return error2 instanceof Error ? error2.message : "Unknown Home Assistant integration error";
}
function createHomeAssistantIntegration(createClient = (url, accessToken, connectWebSocket) => new HomeAssistantWebSocketClient(url, accessToken, void 0, void 0, connectWebSocket)) {
  return defineIntegration({
    id: "homeassistant",
    name: "Home Assistant",
    version: "1.0.0",
    description: "Discover and control Home Assistant entities through Dashwise.",
    config: {
      url: { type: "url", required: true, title: "Home Assistant URL" },
      accessToken: { type: "secret", required: true, title: "Long-lived access token" }
    },
    resources: { entities: entityCollection, status: statusCollection },
    actions: actionDefinitions,
    apps: buildAppContributions(),
    activities: [
      { id: "connection", title: "Home Assistant connection", description: "Show when the configured Home Assistant server is unreachable or reconnecting." },
      { id: "server-stopping", title: "Home Assistant restarting", description: "Show while Home Assistant has announced shutdown and has not announced startup." }
    ],
    widgets: [entityListWidget, sensorOverviewWidget],
    glanceables: [
      connectionStatusGlanceable,
      lightsOnGlanceable,
      sensorValueGlanceable
    ],
    async setup(integrations) {
      if (!integrations.config.url) throw new Error("Home Assistant URL is required");
      if (!await integrations.secrets.get("accessToken")) {
        throw new Error("Home Assistant long-lived access token is required");
      }
    },
    async start(integrations) {
      const accessToken = await integrations.secrets.get("accessToken");
      if (!accessToken) throw new Error("Home Assistant long-lived access token is missing");
      const safeUrl = await integrations.http.assertSafeUrl(integrations.config.url, ["http:", "https:"]);
      const client = createClient(safeUrl.toString(), accessToken, (url) => integrations.websocket.connect(url));
      let connectionStatus = "connecting";
      let hasSnapshot = false;
      let lightsOn = 0;
      let statusSync = Promise.resolve();
      const publishStatuses = () => {
        const records = buildStatusResources({
          connection: connectionStatus,
          lightsOn,
          hasSnapshot,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        statusSync = statusSync.catch(() => void 0).then(
          () => integrations.resources.status.sync(records, { completeness: "complete" })
        );
        return statusSync;
      };
      statusPublishers.set(integrations, async (state) => {
        connectionStatus = state;
        await publishStatuses();
      });
      const stopConnectionListener = client.onConnectionChange((connectionState) => {
        if (connectionState === "disconnected") {
          connectionStatus = "disconnected";
          void publishStatuses().catch((error2) => integrations.logger.error("Could not update Home Assistant status resources", { error: activityError(error2) }));
          integrations.scheduler.timeout("connection-lost-activity", 3e4, async (signal) => {
            if (signal.aborted) return;
            await integrations.activities.upsert("connection", {
              type: "connection",
              title: "Home Assistant is unreachable",
              description: "Dashwise has not received a Home Assistant connection for 30 seconds.",
              severity: "warning"
            });
          });
        } else if (connectionState === "ready") {
          connectionStatus = "connected";
          void publishStatuses().catch((error2) => integrations.logger.error("Could not update Home Assistant status resources", { error: activityError(error2) }));
          integrations.scheduler.cancel("connection-lost-activity");
          void integrations.activities.clear("connection").catch((error2) => integrations.logger.error("Could not clear Home Assistant connection activity", { error: activityError(error2) }));
        } else {
          connectionStatus = "reconnect_error";
          void publishStatuses().catch((error2) => integrations.logger.error("Could not update Home Assistant status resources", { error: activityError(error2) }));
          integrations.scheduler.cancel("connection-lost-activity");
          void integrations.activities.upsert("connection", {
            type: "connection",
            title: "Home Assistant could not reconnect",
            description: "Check that Home Assistant is reachable and the configured access token is valid.",
            severity: "warning"
          }).catch((error2) => integrations.logger.error("Could not publish Home Assistant connection activity", { error: activityError(error2) }));
        }
      });
      integrations.onDispose(stopConnectionListener);
      try {
        await publishStatuses();
        await client.start(async (states2, registries) => {
          if (registries.registryErrors?.length) {
            integrations.logger.warn("Home Assistant registry metadata is incomplete; retaining the last known registry data", {
              errors: registries.registryErrors
            });
          }
          const records = mapEntities(states2, registries.entities);
          await integrations.resources.entities.sync(records, { completeness: "complete" });
          lightsOn = countLightsOn(records);
          hasSnapshot = true;
          if (connectionStatus === "connecting") connectionStatus = "connected";
          await publishStatuses();
        });
        attachClient(integrations, client);
        integrations.onDispose(() => detachClient(integrations));
        integrations.logger.info("Home Assistant connected and entities synchronized", {
          instanceId: integrations.instanceId
        });
      } catch (error2) {
        connectionStatus = "reconnect_error";
        await publishStatuses().catch((statusError) => integrations.logger.error("Could not update Home Assistant status resources", { error: activityError(statusError) }));
        statusPublishers.delete(integrations);
        await client.stop();
        stopConnectionListener();
        throw error2;
      }
      try {
        for (const eventType of [
          "entity_registry_updated",
          "device_registry_updated",
          "area_registry_updated"
        ]) {
          await client.subscribeEvent(eventType, () => {
            void client.refreshDiscovery().catch((error2) => {
              integrations.logger.warn("Home Assistant registry refresh failed; retaining the last complete entity snapshot", {
                eventType,
                error: activityError(error2)
              });
            });
          });
        }
        await client.subscribeEvent("homeassistant_stop", async () => {
          await integrations.activities.upsert("server", {
            type: "server-stopping",
            title: "Home Assistant is restarting or shutting down",
            description: "Home Assistant announced that it is stopping.",
            severity: "warning"
          });
        });
        await client.subscribeEvent("homeassistant_start", async () => {
          await integrations.activities.clear("server");
        });
      } catch (error2) {
        integrations.logger.warn("Home Assistant lifecycle events could not be subscribed", {
          error: activityError(error2)
        });
      }
    },
    async stop(integrations) {
      integrations.scheduler.cancel("connection-lost-activity");
      const publishStatus = statusPublishers.get(integrations);
      statusPublishers.delete(integrations);
      await publishStatus?.("disconnected").catch((error2) => integrations.logger.error("Could not update Home Assistant status resources", { error: activityError(error2) }));
      await stopClient(integrations);
    },
    async dispose(integrations) {
      integrations.scheduler.cancel("connection-lost-activity");
      const publishStatus = statusPublishers.get(integrations);
      statusPublishers.delete(integrations);
      await publishStatus?.("disconnected").catch((error2) => integrations.logger.error("Could not update Home Assistant status resources", { error: activityError(error2) }));
      await stopClient(integrations);
    }
  });
}
var homeAssistant = createHomeAssistantIntegration();
var index_default = homeAssistant;
