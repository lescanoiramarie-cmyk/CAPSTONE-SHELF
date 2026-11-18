import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook to manage modal accessibility: focus trap, ESC key, scroll lock, focus restoration.
 * @param {boolean} isOpen - Whether the modal is open
 * @param {React.RefObject<HTMLElement>} modalRef - Ref to the modal container element
 * @param {React.RefObject<HTMLElement>} triggerRef - Ref to the element that triggered the modal
 * @param {() => void} onClose - Callback to close the modal
 * @returns {Object} - { focusTrapRef: React.RefObject<HTMLDivElement> }
 */
export function useModalAccessibility(isOpen, modalRef, triggerRef, onClose) {
  const focusableElementsRef = useRef([]);
  const previousActiveElementRef = useRef(null);

  // Get all focusable elements within the modal
  const updateFocusableElements = useCallback(() => {
    if (!modalRef.current) return;
    const focusableSelectors = [
      'button:not([disabled]):not([aria-hidden])',
      'a[href]:not([aria-hidden])',
      'input:not([disabled]):not([aria-hidden])',
      'select:not([disabled]):not([aria-hidden])',
      'textarea:not([disabled]):not([aria-hidden])',
      '[tabindex]:not([tabindex="-1"]):not([aria-hidden])',
      '[contenteditable="true"]:not([aria-hidden])',
    ].join(', ');
    focusableElementsRef.current = Array.from(
      modalRef.current.querySelectorAll(focusableSelectors)
    ).filter((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
    });
  }, [modalRef]);

  // Handle focus trap
  const handleKeyDown = useCallback((event) => {
    if (!isOpen || event.key !== 'Tab') return;

    const focusableElements = focusableElementsRef.current;
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey) {
      // Shift + Tab: moving backwards
      if (activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab: moving forwards
      if (activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  }, [isOpen]);

  // Handle Escape key
  const handleEscape = useCallback((event) => {
    if (isOpen && event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }, [isOpen, onClose]);

  // Manage scroll lock and focus when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // Save the previously focused element
      previousActiveElementRef.current = document.activeElement;

      // Lock body scroll
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';

      // Update focusable elements
      updateFocusableElements();

      // Focus the first focusable element or the modal itself
      const modal = modalRef.current;
      if (modal) {
        // Small delay to ensure modal is rendered
        requestAnimationFrame(() => {
          updateFocusableElements();
          const focusable = focusableElementsRef.current;
          if (focusable.length > 0) {
            focusable[0].focus();
          } else {
            modal.focus();
          }
        });
      }
    } else {
      // Restore body scroll
      const scrollY = -parseInt(document.body.style.top || '0', 10);
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);

      // Restore focus to trigger element
      if (triggerRef.current) {
        triggerRef.current.focus();
      } else if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    }

    // Cleanup on unmount
    return () => {
      if (isOpen) {
        const scrollY = -parseInt(document.body.style.top || '0', 10);
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollY);
      }
    };
  }, [isOpen, modalRef, triggerRef, updateFocusableElements]);

  // Add event listeners for focus trap and escape
  useEffect(() => {
    if (!isOpen) return;

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, handleKeyDown, handleEscape]);

  // Recalculate focusable elements when modal content changes
  useEffect(() => {
    if (isOpen) {
      const observer = new MutationObserver(() => {
        updateFocusableElements();
      });

      if (modalRef.current) {
        observer.observe(modalRef.current, { childList: true, subtree: true });
      }

      return () => observer.disconnect();
    }
  }, [isOpen, modalRef, updateFocusableElements]);

  return { updateFocusableElements };
}

export default useModalAccessibility;