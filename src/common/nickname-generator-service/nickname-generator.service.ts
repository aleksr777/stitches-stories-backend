import { Injectable } from '@nestjs/common';

@Injectable()
export class NicknameGeneratorService {
  private getPrefix(length: number): string {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      if (i % 2 === 0) {
        result += letters.charAt(Math.floor(Math.random() * letters.length));
      } else {
        result += digits.charAt(Math.floor(Math.random() * digits.length));
      }
    }
    return result;
  }

  get(): string {
    const nickname = `User_${this.getPrefix(12)}`;
    return nickname;
  }
}
