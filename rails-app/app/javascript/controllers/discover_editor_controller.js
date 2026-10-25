import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["image", "tag", "title", "description", "link", "file", "status"]

  connect() {
    this.originalImage = this.imageTarget.src
    this.localUrl = null
  }

  disconnect() {
    if (this.localUrl) URL.revokeObjectURL(this.localUrl)
  }

  update(event) {
    const field = event.target.dataset.previewField
    const value = event.target.value
    if (["tag", "title", "description"].includes(field)) this[`${field}Target`].textContent = value
    if (field === "image_alt") this.imageTarget.alt = value
    if (field === "website_url") {
      let safe = false
      try {
        const url = new URL(value)
        safe = url.protocol === "https:" && !url.username && !url.password && !/[\x00-\x20\x7f\\]/.test(value) && !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)
        if (safe) this.linkTarget.href = url.href
      } catch (_) { /* Keep invalid destinations inactive in the local preview. */ }
      if (safe) this.linkTarget.removeAttribute("aria-disabled")
      else { this.linkTarget.removeAttribute("href"); this.linkTarget.setAttribute("aria-disabled", "true") }
    }
  }

  async image() {
    const file = this.fileTarget.files[0]
    if (this.localUrl) URL.revokeObjectURL(this.localUrl)
    this.localUrl = null
    this.imageTarget.src = this.originalImage
    this.fileTarget.setCustomValidity("")
    if (!file) { this.status("Picture selection cleared. The saved picture is unchanged."); return }
    let error = ""
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) error = "Choose a JPG, PNG or WebP picture. HEIC photos need to be exported or converted to one of these formats first."
    else if (!file.size) error = "This file is empty. Choose another picture."
    else if (file.size > 5 * 1024 * 1024) error = "This picture is larger than 5 MB. Choose a smaller picture."
    if (error) { this.fileTarget.setCustomValidity(error); this.status(error, true); return }
    this.localUrl = URL.createObjectURL(file)
    const currentUrl = this.localUrl
    this.imageTarget.onerror = () => {
      if (this.localUrl !== currentUrl) return
      this.imageTarget.onerror = null
      const message = "This picture could not be opened. Choose a valid JPG, PNG or WebP picture."
      this.fileTarget.setCustomValidity(message)
      this.imageTarget.src = this.originalImage
      this.status(message, true)
    }
    this.imageTarget.src = this.localUrl
    this.status(`${file.name} is ready to preview. Save this card to update the homepage.`)
  }

  status(message, error = false) {
    this.statusTarget.textContent = message
    this.statusTarget.dataset.error = String(error)
  }
}
