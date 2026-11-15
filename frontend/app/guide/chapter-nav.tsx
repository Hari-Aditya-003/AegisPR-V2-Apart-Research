"use client";

import { useEffect, useRef, useState } from 'react';
import styles from './guide.module.css';

export function ChapterNav({ chapters }: { chapters: readonly (readonly [string, string])[] }) {
  const navigation = useRef<HTMLElement>(null);
  const [active, setActive] = useState(chapters[0][0]);

  useEffect(() => {
    const sections = chapters.map(([id]) => document.getElementById(id));
    let frame = 0;

    function update() {
      frame = 0;
      const viewportOffset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      const chapterOffset = sections[0] ? parseFloat(getComputedStyle(sections[0]).scrollMarginTop) || 0 : 0;
      const line = viewportOffset + chapterOffset + 8;
      let current = chapters[0][0];
      for (const section of sections) {
        if (section && section.getBoundingClientRect().top <= line) current = section.id;
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
        current = chapters.at(-1)?.[0] ?? current;
      }
      setActive(current);
    }

    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }

    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('hashchange', schedule);
    };
  }, [chapters]);

  useEffect(() => {
    const nav = navigation.current;
    const list = nav?.querySelector('ul');
    const current = list?.querySelector('[aria-current="location"]');
    if (!nav || !list || !current) return;

    const reveal = () => {
      const link = current.getBoundingClientRect();
      if (list.scrollWidth > list.clientWidth) {
        const rail = list.getBoundingClientRect();
        if (link.left < rail.left) list.scrollLeft -= rail.left - link.left;
        if (link.right > rail.right) list.scrollLeft += link.right - rail.right;
      }
      if (nav.scrollHeight > nav.clientHeight) {
        const rail = nav.getBoundingClientRect();
        if (link.top < rail.top) nav.scrollTop -= rail.top - link.top;
        if (link.bottom > rail.bottom) nav.scrollTop += link.bottom - rail.bottom;
      }
    };

    reveal();
    window.addEventListener('resize', reveal);
    return () => window.removeEventListener('resize', reveal);
  }, [active]);

  return <nav ref={navigation} className={styles.chapters} aria-label="Guide chapters">
    <p>On this page</p>
    <ul>
      {chapters.map(([id, title]) => (
        <li key={id}><a href={`#${id}`} aria-current={id === active ? 'location' : undefined}>{title}</a></li>
      ))}
    </ul>
  </nav>;
}
