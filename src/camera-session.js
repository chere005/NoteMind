const { CameraModels } = require("./camera-models.js");
const { CameraPersistence } = require("./camera-persistence.js");
const { CameraPictures, pictureRef } = require("./camera-pictures.js");
const { CameraMedia } = require("./camera-media.js");
const { createInkActionController, flushInkMutations, subscribeInkMutations } = require("./ink-mutations.js");
const retainedShutdowns = /* @__PURE__ */ new Set();
class CameraSession {
  constructor({ api, makePage, makeProcessor, pictures = new CameraPictures(), media = new CameraMedia(), models, storage = globalThis.localStorage, validateLegacy = () => true, persistenceFactory = (options) => new CameraPersistence(options), saveDelay = 500, retryDelay = 5e3 } = {}) {
    if (!api || typeof makePage !== "function") throw Error("Invalid camera session.");
    Object.assign(this, { api, makePage, makeProcessor, pictures, media, storage, validateLegacy, persistenceFactory, saveDelay, retryDelay });
    this.models = models || new CameraModels([{ name: "Live", picture: null, page: makePage(), device: "" }]);
    this.page = { current: this.models.current[0].page };
    this.currentView = { current: { page: this.page.current, box: null, corners: null, active: false } };
    this.pictureRef = { current: pictures };
    this.mediaRef = { current: media };
    this.processorRef = { current: makeProcessor?.() || null };
    this.storeRef = { current: null };
    this.workRef = { current: /* @__PURE__ */ new Set() };
    this.keepingRef = { current: false };
    this.captureRef = { current: false };
    this.state = { active: 0, cameraLoaded: false, cameraLoadError: "", error: "", box: null, corners: null, zoom: null, zoomArmed: false, held: null, videoFrame: { width: 1, height: 1 }, takeMode: "ink", toast: "", keeping: false, capturing: false, revision: 0 };
    this.listeners = /* @__PURE__ */ new Set();
    this.setters = /* @__PURE__ */ new Map();
    this.ownerSubscriptions = /* @__PURE__ */ new Map();
    this.actions = /* @__PURE__ */ new WeakMap();
    this.actionSet = /* @__PURE__ */ new Set();
    this.closed = false;
    this.closing = false;
    this.timer = null;
    this.saveChain = Promise.resolve();
    this.loadPromise = null;
    this.shutdownPromise = null;
    this.view = null;
    this.getSnapshot = () => this.state;
    this.subscribe = (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    };
    this.unsubscribeModels = this.models.subscribe(() => {
      this.watchOwners();
      this.syncActive();
      this.scheduleSave();
    });
    this.unsubscribeMutations = subscribeInkMutations((owner) => {
      if (this.owns(owner)) {
        this.bump();
        this.scheduleSave();
      }
    });
    this.watchOwners();
  }
  emit() {
    for (const listener of this.listeners) try {
      listener();
    } catch {
    }
  }
  set(key, next) {
    if (this.closed) return;
    const value = typeof next === "function" ? next(this.state[key]) : next;
    if (Object.is(value, this.state[key])) return;
    this.state = { ...this.state, [key]: value };
    if (key === "active") {
      this.syncActive();
      if (this.state.cameraLoaded) try {
        this.storage?.setItem("notemind.activeCamera", String(value));
      } catch {
      }
    }
    if (key === "revision") this.scheduleSave();
    this.emit();
  }
  setter(key) {
    let setter = this.setters.get(key);
    if (!setter) {
      setter = (next) => this.set(key, next);
      this.setters.set(key, setter);
    }
    return setter;
  }
  bump() {
    this.set("revision", (value) => value + 1);
  }
  owns(owner) {
    return this.models.current.some((row) => row.page === owner);
  }
  syncActive() {
    const row = this.models.current[this.state.active] || this.models.current[0];
    if (row) {
      this.page.current = row.page;
      this.currentView.current = { ...this.currentView.current, page: row.page };
    }
  }
  watchOwners() {
    const next = new Set(this.models.current.map((row) => row.page));
    for (const [owner, unsubscribe] of this.ownerSubscriptions) if (!next.has(owner)) {
      unsubscribe();
      this.ownerSubscriptions.delete(owner);
    }
    for (const owner of next) if (!this.ownerSubscriptions.has(owner)) this.ownerSubscriptions.set(owner, owner.onChange?.(() => {
      this.bump();
      this.scheduleSave();
    }) || (() => {
    }));
  }
  actionsFor(owner) {
    let actions = this.actions.get(owner);
    if (!actions) {
      actions = createInkActionController(owner, { onEdited: () => this.bump(), onError: (failure) => {
        if (failure.name !== "AbortError") this.set("error", failure.message);
      } });
      this.actions.set(owner, actions);
      this.actionSet.add(actions);
    }
    return actions;
  }
  async releaseActions(owner) {
    const actions = this.actions.get(owner);
    if (!actions) return;
    await actions.flush();
    actions.detach();
    this.actions.delete(owner);
    this.actionSet.delete(actions);
  }
  track(work) {
    if (this.closed) throw Error("Camera session is closed.");
    const promise = Promise.resolve(work);
    this.workRef.current.add(promise);
    void promise.finally(() => {
      this.workRef.current.delete(promise);
      this.scheduleSave();
    }).catch(() => {
    });
    return promise;
  }
  attachView(finish) {
    if (this.closed || this.closing) throw Error("Camera session is closed.");
    const token = { finish };
    this.view = token;
    return token;
  }
  detachView(token) {
    if (this.view !== token) return;
    this.view = null;
    try {
      const pending = token.finish?.();
      if (pending && typeof pending.then === "function") this.track(pending);
    } catch (error) {
      this.set("error", error.message);
    }
    this.media.stop();
    this.scheduleSave();
  }
  async load() {
    if (this.loadPromise) return this.loadPromise;
    if (this.closed) throw Error("Camera session is closed.");
    this.loadPromise = (async () => {
      const original = this.models.current, created = /* @__PURE__ */ new Set(), makePage = (aspect) => {
        const page = this.makePage(aspect);
        created.add(page);
        return page;
      };
      try {
        if (this.api.listCameraPages && this.api.loadCameraPage && this.api.saveCameraPagesDelta) {
          const store = this.storeRef.current = this.persistenceFactory({ api: this.api, models: this.models, makePage: () => makePage(1), getActive: () => this.currentView.current.page, pictures: this.pictures, onWarning: (message) => this.set("error", message) });
          await store.load();
        } else {
          const data = await this.api.loadCameraPages();
          if (data != null) {
            if (!this.validateLegacy(data)) throw Error("The camera pages file has an invalid structure.");
            const restored = [];
            try {
              for (const item of data) {
                const page = makePage();
                await page.loadGeometryAsync(item.strokes);
                restored.push({ name: item.name || (item.picture ? "Page" : "Live"), picture: item.picture ? pictureRef(item.picture) : null, page, inkRotation: item.inkRotation ?? item.rotation ?? 0, inkAspect: item.inkAspect ?? (item.aspect && item.aspect !== "free" ? Number(item.aspect) : "free"), rotation: item.rotation || 0, device: item.device || "", aspect: item.aspect || "free", box: item.box || null, corners: item.corners || null, zoom: item.zoom || null });
              }
              this.models.update(restored);
            } catch (error) {
              throw error;
            }
          }
        }
        let remembered = 0;
        try {
          remembered = Number(this.storage?.getItem("notemind.activeCamera")) || 0;
        } catch {
        }
        const index = Math.min(this.models.current.length - 1, Math.max(0, Number.isFinite(remembered) ? Math.floor(remembered) : 0)), selected = this.models.current[index];
        this.state = { ...this.state, active: index, box: selected.box || null, corners: selected.corners || null, zoom: selected.zoom || null, cameraLoaded: true, cameraLoadError: "" };
        this.syncActive();
        this.emit();
        for (const row of original) if (!this.owns(row.page)) await row.page.disposeAsync();
      } catch (error) {
        await Promise.all([...created].filter((page) => !this.owns(page)).map((page) => page.disposeAsync()));
        this.state = { ...this.state, cameraLoaded: true, cameraLoadError: "Camera pages could not be loaded; saving is disabled: " + (error.message || error) };
        this.emit();
        throw error;
      }
      return this.models.current;
    })();
    void this.loadPromise.catch(() => {
    });
    return this.loadPromise;
  }
  scheduleSave(delay = this.saveDelay) {
    if (this.closed || !this.state.cameraLoaded || this.state.cameraLoadError) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const action = this.closing ? this.shutdown() : this.save();
      void action.catch((error) => {
        this.set("error", "Could not save camera pages: " + (error.message || error));
        this.scheduleSave(this.retryDelay);
      });
    }, delay);
    this.timer.unref?.();
  }
  async drain() {
    for (; ; ) {
      const work = [...this.workRef.current];
      if (work.length) await Promise.all(work);
      for (const row of this.models.current) await flushInkMutations(row.page);
      if (!this.workRef.current.size) return;
    }
  }
  save() {
    if (this.closed) return Promise.reject(Error("Camera session is closed."));
    clearTimeout(this.timer);
    this.timer = null;
    const run = async () => {
      await this.load();
      if (this.state.cameraLoadError) throw Error(this.state.cameraLoadError);
      await this.drain();
      const store = this.storeRef.current;
      let result;
      if (store) result = await store.save();
      else {
        const data = this.models.current.map((p) => ({ name: p.name, picture: p.picture?.source || null, strokes: p.page.strokes, inkRotation: p.inkRotation, inkAspect: p.inkAspect, rotation: p.rotation || 0, device: p.device || "", aspect: p.aspect || "free", box: p.box || null, corners: p.corners || null, zoom: p.zoom || null }));
        result = await this.api.saveCameraPages(data);
      }
      if (this.state.error.startsWith("Could not save camera pages:")) this.set("error", "");
      return result;
    };
    const saving = this.saveChain.catch(() => {
    }).then(run);
    this.saveChain = saving;
    return saving;
  }
  async flush() {
    const finish = this.view?.finish;
    await finish?.();
    return this.save();
  }
  shutdown() {
    if (this.closed) return Promise.resolve();
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closing = true;
    retainedShutdowns.add(this);
    const closing = this.shutdownPromise = (async () => {
      try {
        await this.flush();
        await this.drain();
        await this.disposeAfterSave();
        retainedShutdowns.delete(this);
      } catch (error) {
        this.set("error", "Could not save camera pages: " + (error.message || error));
        this.scheduleSave(this.retryDelay);
        throw error;
      } finally {
        this.shutdownPromise = null;
      }
    })();
    return closing;
  }
  async disposeAfterSave() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.view = null;
    this.media.stop();
    this.processorRef.current?.dispose();
    this.processorRef.current = null;
    this.pictures.dispose();
    this.unsubscribeModels();
    this.unsubscribeMutations();
    for (const unsubscribe of this.ownerSubscriptions.values()) unsubscribe();
    this.ownerSubscriptions.clear();
    for (const actions of this.actionSet) actions.detach();
    this.actionSet.clear();
    const store = this.storeRef.current;
    if (store) await store.dispose();
    else await Promise.all(this.models.current.map((row) => row.page.disposeAsync()));
    const held = this.state.held;
    if (held) {
      held.width = 1;
      held.height = 1;
    }
    this.listeners.clear();
  }
}
module.exports = { CameraSession };
