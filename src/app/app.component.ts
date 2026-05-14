import { Component } from '@angular/core';
@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  public appPages = [
    { title: 'Projects', url: '/projects', icon: 'albums' },
    { title: 'Search', url: '/folder/search', icon: 'search' },
    { title: 'Export', url: '/folder/export', icon: 'download' },
    { title: 'Slate Connection', url: '/folder/slate-connection', icon: 'bluetooth' },
    { title: 'Settings', url: '/folder/settings', icon: 'settings' },
  ];
  constructor() {}
}
