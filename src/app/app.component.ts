import { AfterViewInit, Component, NgZone, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { SplashScreen } from '@capacitor/splash-screen';
import { Subscription, filter, take } from 'rxjs';

import { SlateBleService } from './services/slate-ble.service';
import { SlateDatabaseService } from './services/slate-database.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements AfterViewInit, OnDestroy {
  public appPages = [
    { title: 'Projects', url: '/projects', icon: 'albums' },
    { title: 'Search', url: '/folder/search', icon: 'search' },
    { title: 'Export', url: '/folder/export', icon: 'download' },
    { title: 'Slate Connection', url: '/folder/slate-connection', icon: 'bluetooth' },
    { title: 'Settings', url: '/folder/settings', icon: 'settings' },
  ];

  private readonly subscriptions = new Subscription();
  private splash_hidden = false;
  private view_ready = false;
  private route_ready = false;
  private reconnect_started = false;
  private splash_fallback?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly router: Router,
    private readonly zone: NgZone,
    private readonly database: SlateDatabaseService,
    private readonly slate_ble: SlateBleService,
  ) {
    this.subscriptions.add(
      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        take(1)
      ).subscribe(() => {
        this.route_ready = true;
        this.hide_splash_when_ready();
      })
    );
  }

  ngAfterViewInit(): void {
    this.view_ready = true;
    this.hide_splash_when_ready();

    this.splash_fallback = setTimeout(() => {
      this.hide_splash();
    }, 5000);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();

    if (this.splash_fallback) {
      clearTimeout(this.splash_fallback);
    }
  }

  private hide_splash_when_ready(): void {
    if (!this.view_ready || !this.route_ready) {
      return;
    }

    this.hide_splash();
  }

  private hide_splash(): void {
    if (this.splash_hidden) {
      return;
    }

    this.splash_hidden = true;

    if (this.splash_fallback) {
      clearTimeout(this.splash_fallback);
    }

    this.zone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          void SplashScreen.hide({ fadeOutDuration: 150 }).catch(() => undefined);
          void this.reconnect_known_slates();
        }, 150);
      });
    });
  }

  private async reconnect_known_slates(): Promise<void> {
    if (this.reconnect_started) {
      return;
    }

    this.reconnect_started = true;
    try {
      const targets = await this.database.list_slate_connection_targets();
      const device_ids = targets
        .map((target) => target.bluetooth_device_id)
        .filter((device_id): device_id is string => Boolean(device_id));
      await this.slate_ble.reconnect_known_devices(device_ids);
    } catch {
      // Slate Connection shows the detailed BLE log; startup should stay quiet.
    }
  }
}
