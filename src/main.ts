import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { defineCustomElements as define_jeep_sqlite_custom_elements } from 'jeep-sqlite/loader';

import { AppModule } from './app/app.module';

define_jeep_sqlite_custom_elements(window);

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.log(err));
