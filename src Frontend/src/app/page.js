import { redirect } from 'next/navigation';

// La raíz lleva al dashboard; proxy.ts manda a /login si no hay sesión.
export default function Home() {
  redirect('/dashboard');
}
