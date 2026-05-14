import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-folder',
  templateUrl: './folder.page.html',
  styleUrls: ['./folder.page.scss'],
  standalone: false,
})
export class FolderPage implements OnInit {
  public folder!: string;
  public page_title!: string;
  public page_summary!: string;
  private activatedRoute = inject(ActivatedRoute);
  constructor() {}

  ngOnInit() {
    this.folder = this.activatedRoute.snapshot.paramMap.get('id') as string;
    const page = section_pages[this.folder] ?? section_pages['projects'];
    this.page_title = page.title;
    this.page_summary = page.summary;
  }
}

const section_pages: Record<string, { title: string; summary: string }> = {
  projects: {
    title: 'Projects',
    summary: 'Create and manage productions, shoot days, slates, shared scenes, and takes.',
  },
  search: {
    title: 'Search',
    summary: 'Find scenes, takes, notes, flags, and timecode metadata across the current project.',
  },
  export: {
    title: 'Export',
    summary: 'Prepare CSV and JSON exports for editorial workflows and future Resolve helpers.',
  },
  'slate-connection': {
    title: 'Slate Connection',
    summary: 'Connect to physical slates over Bluetooth, or use fake slate events during app development.',
  },
  settings: {
    title: 'Settings',
    summary: 'Configure app preferences, connection defaults, export options, and slate behaviour.',
  },
};
