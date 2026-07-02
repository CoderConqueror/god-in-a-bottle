import { useEffect } from 'react';
import { game, useGame } from './state/store';
import { TopBar } from './ui/TopBar';
import { BottleView } from './ui/Bottle';
import { LeftColumn, RightColumn } from './ui/Panels';
import { Timeline } from './ui/Charts';
import { Onboarding, Summary, SavesModal, SeedModal, Toast } from './ui/Overlays';

export default function App(): JSX.Element {
  useGame();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') { e.preventDefault(); game.toggle(); }
      if (e.key === 'Escape') { game.cancelTargeting(); game.setModal('none'); }
      if (e.key >= '1' && e.key <= '4') game.setSpeed(+e.key - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <div className="stars" aria-hidden />
      <TopBar />
      <main className="layout">
        <LeftColumn />
        <section className="center">
          <BottleView />
          <Timeline />
        </section>
        <RightColumn />
      </main>
      <Onboarding />
      <Summary />
      <SavesModal />
      <SeedModal />
      <Toast />
    </div>
  );
}
