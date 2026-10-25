import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  connect() {
    this.summary = this.element.querySelector("summary")
    this.navigation = this.element.querySelector("nav")
    if (this.navigation && !this.navigation.id) this.navigation.id = `isp-menu-${Math.random().toString(36).slice(2, 9)}`
    if (this.summary && this.navigation) this.summary.setAttribute("aria-controls", this.navigation.id)
    this.onToggle = () => this.summary?.setAttribute("aria-expanded", String(this.element.open))
    this.onPointerDown = (event) => {
      if (this.element.open && !this.element.contains(event.target)) this.close()
    }
    this.onFocusIn = (event) => {
      if (this.element.open && !this.element.contains(event.target)) this.close()
    }
    this.onKeyDown = (event) => {
      if (event.key === "Escape" && this.element.open) {
        event.preventDefault()
        this.close()
        this.summary?.focus()
      }
    }
    this.onClick = (event) => {
      if (event.target.closest("nav a, nav button")) this.close()
    }
    this.onBeforeCache = () => this.close()
    this.element.addEventListener("toggle", this.onToggle)
    this.element.addEventListener("click", this.onClick)
    document.addEventListener("pointerdown", this.onPointerDown)
    document.addEventListener("focusin", this.onFocusIn)
    document.addEventListener("keydown", this.onKeyDown)
    document.addEventListener("turbo:before-cache", this.onBeforeCache)
    this.onToggle()
  }

  disconnect() {
    this.element.removeEventListener("toggle", this.onToggle)
    this.element.removeEventListener("click", this.onClick)
    document.removeEventListener("pointerdown", this.onPointerDown)
    document.removeEventListener("focusin", this.onFocusIn)
    document.removeEventListener("keydown", this.onKeyDown)
    document.removeEventListener("turbo:before-cache", this.onBeforeCache)
  }

  close() {
    this.element.open = false
    this.onToggle()
  }
}