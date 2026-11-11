/**
 * HelpModal - A reusable, dependency-free help modal system
 *
 * Usage:
 * HelpModal.init({
 *   triggerSelector: '#btn-help',
 *   content: helpContent,
 *   theme: 'auto'
 * });
 */

class HelpModal {
  constructor(options = {}) {
    this.options = {
      triggerSelector: '#btn-help',
      content: '',
      theme: 'auto', // 'light', 'dark', or 'auto'
      customStyles: {},
      ...options
    };

    this.isOpen = false;
    this.modal = null;
    this.trigger = null;

    this.init();
  }

  init() {
    this.createModal();
    this.bindEvents();
  }

  createModal() {
    // Create modal container
    this.modal = document.createElement('div');
    this.modal.className = 'help-modal';
    this.modal.innerHTML = `
      <div class="help-modal-backdrop"></div>
      <div class="help-modal-content">
        <div class="help-modal-header">
          <h2>Help / User Guide</h2>
          <button class="help-modal-close" type="button" aria-label="Close help">×</button>
        </div>
        <div class="help-modal-body">
          ${this.options.content}
        </div>
      </div>
    `;

    // Initially hidden
    this.modal.style.display = 'none';
    document.body.appendChild(this.modal);
  }

  bindEvents() {
    // Find trigger element
    this.trigger = document.querySelector(this.options.triggerSelector);
    if (!this.trigger) {
      console.warn(`HelpModal: Trigger element '${this.options.triggerSelector}' not found`);
      return;
    }

    // Convert link to button if needed
    if (this.trigger.tagName === 'A') {
      this.trigger.addEventListener('click', (e) => {
        e.preventDefault();
        this.open();
      });
    } else {
      this.trigger.addEventListener('click', () => this.open());
    }

    // Close button
    const closeBtn = this.modal.querySelector('.help-modal-close');
    closeBtn.addEventListener('click', () => this.close());

    // Backdrop click
    const backdrop = this.modal.querySelector('.help-modal-backdrop');
    backdrop.addEventListener('click', () => this.close());

    // ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    // Handle internal navigation links
    this.modal.addEventListener('click', (e) => {
      if (e.target.matches('a[href^="#"]')) {
        e.preventDefault();
        const targetId = e.target.getAttribute('href').substring(1);
        const targetElement = this.modal.querySelector(`#${targetId}`);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  }

  open() {
    if (this.isOpen) return;

    this.isOpen = true;
    this.modal.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Prevent background scrolling

    // Focus management
    const closeBtn = this.modal.querySelector('.help-modal-close');
    closeBtn.focus();

    // Trigger custom event
    this.trigger.dispatchEvent(new CustomEvent('helpModal:open', { detail: this }));
  }

  close() {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.modal.style.display = 'none';
    document.body.style.overflow = ''; // Restore scrolling

    // Return focus to trigger
    this.trigger.focus();

    // Trigger custom event
    this.trigger.dispatchEvent(new CustomEvent('helpModal:close', { detail: this }));
  }

  // Public API methods
  static init(options) {
    return new HelpModal(options);
  }

  destroy() {
    if (this.modal && this.modal.parentNode) {
      this.modal.parentNode.removeChild(this.modal);
    }
    document.body.style.overflow = '';
  }
}

// Export for use
window.HelpModal = HelpModal;
