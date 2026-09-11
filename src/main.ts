import './style.css';
import { spriteMarkup } from './assets/sprite';
import { App } from './ui/app';

document.body.insertAdjacentHTML('afterbegin', spriteMarkup());
new App(document.getElementById('app')!);
