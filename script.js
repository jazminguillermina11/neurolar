// Menú móvil
const menuBtn = document.getElementById('menuBtn');
const menu = document.getElementById('menu');

menuBtn.addEventListener('click', () => {
  const abierto = menu.classList.toggle('open');
  menuBtn.classList.toggle('open', abierto);
  menuBtn.setAttribute('aria-expanded', abierto);
});

// Cerrar el menú al tocar un enlace
menu.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    menu.classList.remove('open');
    menuBtn.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  });
});

// Animación de aparición al hacer scroll
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// Año automático en el pie de página
document.getElementById('year').textContent = new Date().getFullYear();

// Preguntas frecuentes: una abierta a la vez
const preguntas = document.querySelectorAll('.faq-item');
preguntas.forEach(item => {
  item.addEventListener('toggle', () => {
    if (item.open) {
      preguntas.forEach(otra => { if (otra !== item) otra.open = false; });
    }
  });
});
