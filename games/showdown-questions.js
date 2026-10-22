/*
 * Team Showdown: default rounds and questions. The admin dashboard can edit all of
 * these; this file is only the starting point.
 *
 * Every answer has been checked: one defensible correct answer per question
 * ("Name Five" is judged by the facilitator).
 *   - "accept" lists other spellings that count as correct when answers are typed.
 *   - "display" is shown in large letters (cracked words, scrambles).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubShowdownBank = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return {
    rounds: [
      {
        id: 'cracked',
        title: 'Cracked Word',
        type: 'buzzer',
        intro: 'Most of the letters are missing. Buzz in as soon as you know the word.',
        timeSec: 20,
        points: 100,
        double: false,
        enabled: true,
        questions: [
          { prompt: 'Crack the word', display: 'F _ _ T H F _ L N _ S S', answer: 'FAITHFULNESS' },
          { prompt: 'Crack the word', display: '_ E _ E M _ _ I _ N', answer: 'REDEMPTION' },
          { prompt: 'Crack the word', display: 'G _ N _ R _ S _ T Y', answer: 'GENEROSITY' },
          { prompt: 'Crack the word', display: 'C _ M P _ S S _ _ N', answer: 'COMPASSION' },
          { prompt: 'Crack the word', display: 'P _ _ V _ D _ N C _', answer: 'PROVIDENCE' },
          { prompt: 'Crack the word', display: 'R _ S T _ R _ T _ _ N', answer: 'RESTORATION' },
        ],
      },
      {
        id: 'scramble',
        title: 'Scramble Sprint',
        type: 'buzzer',
        intro: 'Unscramble the letters into one word before the clock runs out.',
        timeSec: 20,
        points: 100,
        double: false,
        enabled: true,
        questions: [
          { prompt: 'Unscramble', display: 'T L A O Y L Y', answer: 'LOYALTY' },
          { prompt: 'Unscramble', display: 'N P E D O M I R E T', answer: 'REDEMPTION' },
          { prompt: 'Unscramble', display: 'R I H T C E N I A N E', answer: 'INHERITANCE' },
          { prompt: 'Unscramble', display: 'H I A T F L U F', answer: 'FAITHFUL' },
          { prompt: 'Unscramble', display: 'V A H R E T S', answer: 'HARVEST' },
          { prompt: 'Unscramble', display: 'B E M H E E T L H', answer: 'BETHLEHEM' },
        ],
      },
      {
        id: 'brain',
        title: 'Brain Benders',
        type: 'buzzer',
        intro: 'Logic and numbers. Think before you buzz: a wrong answer costs points.',
        timeSec: 30,
        points: 150,
        double: false,
        enabled: true,
        questions: [
          {
            prompt: 'A bat and a ball cost KES 110 in total. The bat costs KES 100 more than the ball. How much is the ball?',
            answer: 'KES 5',
            accept: ['5', 'kes 5', '5 shillings', '5 bob', 'ksh 5', 'five'],
            note: 'Ball 5 + bat 105 = 110. (KES 10 is the trap: then the bat would cost 110.)',
          },
          { prompt: 'What comes next: 2, 6, 12, 20, 30, …?', answer: '42', accept: ['forty two', 'forty-two'], note: 'n × (n + 1): 6 × 7 = 42.' },
          { prompt: 'What comes next: 1, 1, 2, 3, 5, 8, 13, …?', answer: '21', accept: ['twenty one', 'twenty-one'], note: 'Each number is the sum of the two before it.' },
          {
            prompt: 'At 3:15, what is the angle between the hour and minute hands of a clock?',
            answer: '7.5°',
            accept: ['7.5', '7.5 degrees', '7 and a half degrees', '7½'],
            note: 'The minute hand is at 90°. The hour hand has moved a quarter of the way from 3 to 4: 90° + 7.5°.',
          },
          { prompt: 'What is 15% of 240?', answer: '36', accept: ['thirty six', 'thirty-six'] },
          {
            prompt: 'How many times can you subtract 5 from 25?',
            answer: 'Once',
            accept: ['one', '1', 'one time', 'once only', 'only once'],
            note: 'After the first time, you are subtracting 5 from 20.',
          },
        ],
      },
      {
        id: 'lightning',
        title: 'General Knowledge Lightning',
        type: 'buzzer',
        intro: 'Ten seconds a question, and every answer is worth double!',
        timeSec: 10,
        points: 100,
        double: true,
        enabled: true,
        questions: [
          { prompt: 'What is the chemical symbol for gold?', answer: 'Au' },
          { prompt: 'What is the smallest prime number?', answer: '2', accept: ['two'] },
          { prompt: 'What is the longest river in Africa?', answer: 'The Nile', accept: ['nile', 'nile river', 'river nile'] },
          { prompt: 'How many bones are in the adult human body?', answer: '206', accept: ['two hundred and six', 'two hundred six'] },
          { prompt: 'What is the capital city of Australia?', answer: 'Canberra' },
          { prompt: 'What is the square root of 169?', answer: '13', accept: ['thirteen'] },
          { prompt: 'How many minutes are there in a day?', answer: '1,440', accept: ['1440', '1 440'] },
        ],
      },
      {
        id: 'namefive',
        title: 'Name Five',
        type: 'judged',
        intro: 'Each team gets 30 seconds to name five. Repeats of another team’s answers don’t count. The facilitator decides.',
        timeSec: 30,
        points: 20,
        bonus: 20,
        double: false,
        enabled: true,
        questions: [
          { prompt: 'Name five books of the Old Testament.' },
          { prompt: 'Name five African capital cities.' },
          { prompt: 'Name five qualities of a good leader.' },
        ],
      },
      {
        id: 'ruth',
        title: 'Ruth Deep Cuts',
        type: 'buzzer',
        intro: 'Bonus round on the Book of Ruth. Were you listening during the teaching?',
        timeSec: 15,
        points: 150,
        double: false,
        enabled: false,
        questions: [
          { prompt: 'Who was the son of Ruth and Boaz?', answer: 'Obed', note: 'Ruth 4:17' },
          { prompt: 'Obed was the father of whom?', answer: 'Jesse', note: 'Ruth 4:17' },
          { prompt: 'In what town did Boaz hold the meeting at the gate?', answer: 'Bethlehem', note: 'Ruth 4:1, 4:11' },
          { prompt: 'How many elders of the town did Boaz gather as witnesses?', answer: 'Ten', accept: ['10'], note: 'Ruth 4:2' },
          { prompt: 'Who was Ruth’s first husband?', answer: 'Mahlon', note: 'Ruth 4:10' },
        ],
      },
    ],
    wager: {
      prompt: 'How many seconds are there in one day?',
      answer: '86,400',
      accept: ['86400', '86 400', '86.400'],
      note: '24 × 60 × 60 = 86,400.',
    },
    tiebreakers: [
      { prompt: 'What is 17 × 6?', answer: '102' },
      { prompt: 'How many hours are there in a week?', answer: '168' },
      { prompt: 'What is the next prime number after 31?', answer: '37' },
    ],
  };
});
