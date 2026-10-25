import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["slide", "dot", "pause", "announcement"]

  connect() {
    this.index = Math.max(0, this.slideTargets.findIndex((slide) => !slide.hidden))
    this.motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)")
    this.userPaused = this.motionPreference.matches
    this.hovered = false
    this.focused = this.element.contains(document.activeElement)
    this.onVisibilityChange = () => this.schedule()
    this.onMotionChange = (event) => {
      if (event.matches) this.userPaused = true
      this.updatePauseButton()
      this.schedule()
    }
    this.onKeyDown = (event) => this.keydown(event)
    document.addEventListener("visibilitychange", this.onVisibilityChange)
    this.motionPreference.addEventListener("change", this.onMotionChange)
    this.element.addEventListener("keydown", this.onKeyDown)
    this.render(false)
    this.schedule()
  }

  disconnect() {
    window.clearTimeout(this.timer)
    document.removeEventListener("visibilitychange", this.onVisibilityChange)
    this.motionPreference?.removeEventListener("change", this.onMotionChange)
    this.element.removeEventListener("keydown", this.onKeyDown)
  }

  previous() { this.goTo(this.index - 1) }
  next() { this.goTo(this.index + 1) }
  select(event) { this.goTo(Number(event.currentTarget.dataset.index)) }

  toggle() {
    this.userPaused = !this.userPaused
    this.updatePauseButton()
    this.schedule()
  }

  hover() { this.hovered = true; this.schedule() }
  leave() { this.hovered = false; this.schedule() }
  focus() { this.focused = true; this.schedule() }
  blur(event) {
    this.focused = this.element.contains(event.relatedTarget)
    this.schedule()
  }

  keydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.target.matches("input, textarea, select, [contenteditable=true]")) return
    const actions = {
      ArrowLeft: () => this.previous(),
      ArrowRight: () => this.next(),
      Home: () => this.goTo(0),
      End: () => this.goTo(this.slideTargets.length - 1)
    }
    if (actions[event.key]) {
      event.preventDefault()
      actions[event.key]()
    }
  }

  goTo(index, announce = true) {
    if (!this.slideTargets.length || !Number.isFinite(index)) return
    const focusWasInSlide = this.slideTargets[this.index]?.contains(document.activeElement)
    this.index = (index + this.slideTargets.length) % this.slideTargets.length
    this.render(announce)
    if (focusWasInSlide) this.slideTargets[this.index].querySelector("a, button")?.focus({ preventScroll: true })
    this.schedule()
  }

  render(announce) {
    this.slideTargets.forEach((slide, index) => {
      slide.hidden = index !== this.index
      slide.setAttribute("aria-hidden", String(index !== this.index))
      slide.setAttribute("role", "group")
      slide.setAttribute("aria-roledescription", "slide")
    })
    this.dotTargets.forEach((dot, index) => {
      if (index === this.index) dot.setAttribute("aria-current", "true")
      else dot.removeAttribute("aria-current")
    })
    this.updatePauseButton()
    if (announce && this.hasAnnouncementTarget) {
      const title = this.slideTargets[this.index].querySelector("h3")?.textContent || ""
      this.announcementTarget.textContent = `Slide ${this.index + 1} of ${this.slideTargets.length}. ${title}`
    }
  }

  updatePauseButton() {
    if (!this.hasPauseTarget) return
    this.pauseTarget.textContent = this.userPaused ? "Play" : "Pause"
    this.pauseTarget.setAttribute("aria-label", this.userPaused ? "Start automatic slide rotation" : "Pause automatic slide rotation")
    this.pauseTarget.setAttribute("aria-pressed", String(this.userPaused))
  }

  schedule() {
    window.clearTimeout(this.timer)
    if (this.userPaused || this.hovered || this.focused || document.hidden || this.slideTargets.length < 2) return
    this.timer = window.setTimeout(() => this.goTo(this.index + 1, false), 8500)
  }
}